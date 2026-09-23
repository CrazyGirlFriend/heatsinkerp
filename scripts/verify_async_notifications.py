"""Real two-worker RabbitMQ probes, restricted to the disposable MySQL fixture.

Run inside the isolated application container. The external test runner controls
its own broker between `live`, `outage`, and `recovery`; no Docker socket needed.
Never accepts production URLs or database names.
"""

import argparse
import asyncio
import json
import os
from http.client import HTTPConnection
from time import monotonic, sleep
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4


def request(host, token, path, body=None, allowed=(200, 201, 204)):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = Request(
        "http://" + host + ":8000" + path,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        response = build_opener(ProxyHandler({})).open(req, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        data = response.read()
        assert response.status in allowed, f"{path}: {response.status}"
    return json.loads(data) if data else None


def wait_for(operation, check, timeout=40):
    end = monotonic() + timeout
    while monotonic() < end:
        result = operation()
        if check(result):
            return result
        sleep(0.2)
    raise AssertionError("Timed out waiting for isolated notification state")


def frame(response):
    while line := response.readline():
        if line.startswith(b"data: "):
            return json.loads(line[6:])
    raise AssertionError("Unexpected stream EOF")


def assert_isolated():
    assert os.environ.get("APP_ENV") == "test"
    assert os.environ.get("MYSQL_HOST") == "validation-db"
    assert os.environ.get("MYSQL_DATABASE") == "heatsink_capacity_20260923"
    assert os.environ.get("MQ_HOST") == "validation-mq"
    from app.database import engine

    assert engine.dialect.name == "mysql" and engine.url.database == "heatsink_capacity_20260923"


async def native_async_probe():
    from app.database import AsyncSessionLocal, async_engine
    from sqlalchemy import text

    assert async_engine.dialect.is_async and async_engine.dialect.driver == "asyncmy"
    async with AsyncSessionLocal() as db:
        await db.execute(text("SELECT 1"))
        query = asyncio.create_task(db.execute(text("SELECT SLEEP(0.3)")))
        ticks = 0
        while not query.done():
            await asyncio.sleep(0.01)
            ticks += 1
        await query
        assert ticks >= 10, "Database I/O blocked the event loop"
    await async_engine.dispose()
    return ticks


async def queue_probe(team_id):
    import aio_pika
    from app.config import settings
    from app.inventory_events import InventoryChange
    from app.notification_queue import EXCHANGE

    async with await aio_pika.connect(settings.message_queue_url) as connection:
        channel = await connection.channel(publisher_confirms=True, on_return_raises=True)
        exchange = await channel.get_exchange(EXCHANGE)
        message_id = uuid4().hex
        payload = json.dumps(InventoryChange(team_ids=frozenset((team_id,))).envelope()).encode()
        for _ in range(2):
            await exchange.publish(
                aio_pika.Message(
                    body=payload,
                    message_id=message_id,
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                ),
                routing_key="",
                mandatory=True,
            )
        await exchange.publish(
            aio_pika.Message(
                body=b"invalid-test-envelope", delivery_mode=aio_pika.DeliveryMode.PERSISTENT
            ),
            routing_key="",
            mandatory=True,
        )
        queue = await channel.get_queue(EXCHANGE + ".dead")
        # Both worker queues reject their own copy into the dead-letter queue.
        rejected = 0
        for _ in range(50):
            message = await queue.get(fail=False)
            if message is not None:
                assert message.body == b"invalid-test-envelope"
                await message.ack()
                rejected += 1
                if rejected == 2:
                    break
            await asyncio.sleep(0.1)
        assert rejected == 2
        return rejected


def probe(phase):
    assert_isolated()
    tokens = []

    def login(name):
        data = request(
            "127.0.0.1",
            None,
            "/api/auth/login",
            {"username": name, "password": os.environ["SEED_ADMIN_PASSWORD"]},
        )
        tokens.append(data["access_token"])
        return data

    admin = login("admin")["access_token"]
    leader = login("demo_warehouse")
    token, team = leader["access_token"], leader["user"]["team_id"]

    def status(host="127.0.0.1"):
        return request(host, admin, "/api/notifications/status")

    def stock(host="127.0.0.1"):
        return request(host, admin, "/api/factory-overview")["totals"]["on_hand_quantity"]

    def receipt(suffix):
        return request(
            "127.0.0.1",
            token,
            f"/api/team-materials/{team}/receipts",
            {
                "serial_no": "MQ-QA-" + suffix,
                "material_name": "铜钼 CuMo70",
                "material_type": "semi_finished",
                "quantity": 7,
                "weight": ".7",
                "notes": "隔离消息队列验证",
                "idempotency_key": "mq-qa-" + suffix,
            },
        )

    try:
        if phase == "outage":
            for host in ("127.0.0.1", "validation-peer"):
                wait_for(
                    lambda host=host: status(host),
                    lambda value: value["connection"] == "reconnecting",
                )
                request(host, admin, "/api/factory-overview/stream", allowed=(503,))
            before = stock()
            receipt("outage")
            receipt("outage")  # Same request does not create duplicate stock.
            assert stock() == stock("validation-peer") == before + 7
            assert status()["pending"] >= 1
            return {"outage": "passed", "pending": status()["pending"]}
        for host in ("127.0.0.1", "validation-peer"):
            wait_for(
                lambda host=host: status(host),
                lambda value: value["connection"] == "connected" and value["pending"] == 0,
            )
        if phase == "recovery":
            from app.database import SessionLocal
            from app.models import MaterialStockBalance, MaterialTransfer
            from sqlalchemy import select

            with SessionLocal() as db:
                quantity = db.scalar(
                    select(MaterialStockBalance.on_hand_quantity)
                    .join(MaterialTransfer, MaterialTransfer.id == MaterialStockBalance.transfer_id)
                    .where(MaterialTransfer.serial_no == "MQ-QA-outage")
                )
                assert quantity == 7
            return {"recovery": "passed", "pending": status()["pending"]}
        connections, responses = [], []
        try:
            for host in ("127.0.0.1", "validation-peer"):
                connection = HTTPConnection(host, 8000, timeout=15)
                connections.append(connection)
                connection.request(
                    "GET",
                    "/api/factory-overview/stream",
                    headers={"Authorization": "Bearer " + admin},
                )
                response = connection.getresponse()
                responses.append(response)
                assert response.status == 200
                first = frame(response)
            before = first["totals"]["on_hand_quantity"]
            started = monotonic()
            receipt("live-" + uuid4().hex)
            for response in responses:
                while frame(response)["totals"]["on_hand_quantity"] != before + 7:
                    assert monotonic() - started < 10
            latency = round((monotonic() - started) * 1000, 1)
            rejected = asyncio.run(queue_probe(team))
            assert stock() == stock("validation-peer") == before + 7
            ticks = asyncio.run(native_async_probe())
            return {
                "cross_worker_fanout": "passed",
                "write_to_both_streams_ms": latency,
                "duplicate_does_not_mutate_stock": True,
                "dead_letter_copies": rejected,
                "async_mysql_loop_ticks": ticks,
            }
        finally:
            for response in responses:
                response.close()
            for connection in connections:
                connection.close()
    finally:
        for token in tokens:
            request("127.0.0.1", token, "/api/auth/logout", {})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("live", "outage", "recovery"))
    print(json.dumps(probe(parser.parse_args().phase)), flush=True)
