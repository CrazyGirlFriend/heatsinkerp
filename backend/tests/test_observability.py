import asyncio
import json
import traceback

import pytest
from app.observability import RequestLogMiddleware, logger, measure_database, request_id
from fastapi import HTTPException


def capture(monkeypatch):
    records = []
    monkeypatch.setattr(logger, "log", lambda level, message: records.append(json.loads(message)))
    return records


def test_request_id_is_local_and_route_is_template(client, monkeypatch):
    records = capture(monkeypatch)
    response = client.get(
        "/api/teams/999?password=QUERY-SECRET",
        headers={
            "X-Request-ID": "HEADER-SECRET",
            "Cookie": "secret=COOKIE-SECRET",
        },
    )
    correlation = response.headers["x-request-id"]
    assert len(correlation) == 32
    assert response.status_code == 404
    assert records[-1]["route"] == "/api/teams/{team_id}"
    assert records[-1]["request_id"] == correlation
    assert records[-1]["is_stream"] is False
    assert records[-1]["sql_count"] > 0
    assert 0 <= records[-1]["sql_ms"] <= records[-1]["duration_ms"]
    assert 0 <= records[-1]["first_body_ms"] <= records[-1]["duration_ms"]
    assert "SECRET" not in json.dumps(records)
    assert request_id.get() is None


def test_database_timing_counts_failures_without_logging_sql_or_parameters(client, monkeypatch):
    from app.database import SessionLocal
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    records = capture(monkeypatch)
    with measure_database() as timing, SessionLocal() as db:
        db.execute(text("SELECT :value"), {"value": "PRIVATE-PARAMETER"})
        with pytest.raises(DBAPIError):
            db.execute(text("SELECT * FROM PRIVATE_TABLE_DOES_NOT_EXIST"))
    assert timing.sql_count == 2 and timing.sql_ms > 0
    assert records == []


def test_async_database_measurements_are_task_local(client):
    from app.database import AsyncSessionLocal
    from sqlalchemy import text

    async def query(count):
        with measure_database() as timing:
            async with AsyncSessionLocal() as db:
                for _ in range(count):
                    await db.execute(text("SELECT 1"))
                    await asyncio.sleep(0)
            return timing.sql_count

    async def run():
        assert await asyncio.gather(query(2), query(5)) == [2, 5]

    asyncio.run(run())


def test_unexpected_exception_returns_safe_correlated_500(monkeypatch):
    records = capture(monkeypatch)

    async def broken(scope, receive, send):
        raise ValueError("password=EXCEPTION-SECRET sql params=PRIVATE")

    messages = []

    async def send(message):
        messages.append(message)

    asyncio.run(RequestLogMiddleware(broken)({"type": "http", "method": "GET"}, None, send))
    assert messages[0]["status"] == 500
    assert dict(messages[0]["headers"])[b"x-request-id"].decode() == records[0]["request_id"]
    assert records[0]["error_type"] == "ValueError"
    assert records[0]["frames"][-1]["function"] == "broken"
    assert "SECRET" not in json.dumps(records) + str(messages)


def test_stream_is_forwarded_before_completion_and_context_is_isolated(monkeypatch):
    records = capture(monkeypatch)

    async def scenario():
        ready = [asyncio.Event(), asyncio.Event()]
        finish = asyncio.Event()
        ids = []
        chunks = [[], []]

        async def stream(scope, receive, send):
            own_id = request_id.get()
            ids.append(own_id)
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"text/event-stream; charset=utf-8")],
                }
            )
            await send({"type": "http.response.body", "body": b"data: {}\n\n", "more_body": True})
            ready[scope["index"]].set()
            await finish.wait()
            assert request_id.get() == own_id
            await send({"type": "http.response.body", "body": b"", "more_body": False})

        async def run(index):
            async def send(message):
                chunks[index].append(message)

            await RequestLogMiddleware(stream)(
                {"type": "http", "method": "GET", "index": index}, None, send
            )

        tasks = [asyncio.create_task(run(i)) for i in range(2)]
        try:
            await asyncio.wait_for(asyncio.gather(*(event.wait() for event in ready)), 2)
            assert all(messages[-1]["body"] == b"data: {}\n\n" for messages in chunks)
            assert len(set(ids)) == 2 and records == []
            assert request_id.get() is None
        finally:
            finish.set()
            await asyncio.gather(*tasks)
        assert len(records) == 2
        assert all(row["is_stream"] for row in records)
        assert all(0 <= row["first_body_ms"] <= row["duration_ms"] for row in records)

    asyncio.run(scenario())


def test_health_records_safe_failure(monkeypatch):
    from app.auth_api import health

    records = capture(monkeypatch)

    class BrokenDatabase:
        def execute(self, query):
            raise RuntimeError("DB-CREDENTIAL-SECRET")

    with pytest.raises(HTTPException) as error:
        health(BrokenDatabase())
    assert error.value.status_code == 503
    assert records[0]["event"] == "health.database_unavailable"
    assert "SECRET" not in json.dumps(records)


def test_stream_failure_keeps_original_status_and_sanitizes_server_exception(monkeypatch):
    records = capture(monkeypatch)
    messages = []

    async def stream(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise ValueError("PRIVATE-SQL-PARAMETERS")

    async def send(message):
        messages.append(message)

    with pytest.raises(RuntimeError) as error:
        asyncio.run(RequestLogMiddleware(stream)({"type": "http", "method": "GET"}, None, send))
    assert len(messages) == 1
    assert records[-1]["status"] == 200
    assert records[0]["event"] == "request.failed"
    rendered = "".join(traceback.format_exception(error.value))
    # This is the representation Uvicorn will log after it closes the stream.
    assert "PRIVATE-SQL-PARAMETERS" not in rendered
    assert request_id.get() is None
