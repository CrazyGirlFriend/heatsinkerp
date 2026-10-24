"""Workbench time ordering is global and revisions replace the displayed record."""

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models import ProcessRoute
from test_engineering_team import engineering as engineering  # noqa: F401
from test_process_route_intake import publish_payload, route_payload
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def test_global_time_ordering_pagination_and_legacy_fallback(client):
    base = datetime(2026, 10, 1)
    with SessionLocal() as db:
        rows = [
            ProcessRoute(
                title="SORT-CHECK",
                filename="",
                source_sha256="",
                source_file=b"",
                source_data={"tables": [], "issues": []},
                serial_nos=[f"SORT-{index:02}"],
                steps=[],
                created_by="admin",
                created_at=base + timedelta(hours=index),
                updated_at=base + timedelta(hours=24 - index),
            )
            for index in range(24)
        ]
        db.add_all(rows)
        db.flush()
        rows[10].updated_at = None
        rows[10].created_at = base + timedelta(days=3)
        rows[5].updated_at = rows[6].updated_at
        db.flush()
        expected = [
            row.id
            for row in sorted(
                rows, key=lambda row: (row.updated_at or row.created_at, row.id), reverse=True
            )
        ]
        db.commit()
    response = client.get(URL, params={"query": "SORT-", "page_size": 5})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 24
    assert [row["id"] for row in response.json()["items"]] == expected[:5]
    second = client.get(URL, params={"query": "SORT-", "page_size": 5, "page": 2}).json()
    assert [row["id"] for row in second["items"]] == expected[5:10]
    ascending = client.get(
        URL, params={"query": "SORT-", "page_size": 10, "sort_order": "asc"}
    ).json()
    assert [row["id"] for row in ascending["items"]] == list(reversed(expected))[:10]
    assert client.get(URL, params={"sort_order": "bad"}).status_code == 422
    assert client.get(URL, params={"page_size": 101}).status_code == 422


def test_saved_revision_is_the_current_row_and_old_reference_stays_readable(
    client, warehouse, engineering
):
    original = publish_payload(client, route_payload(client, warehouse))
    first = client.post(f"{URL}/{original['id']}/revise", headers=engineering["headers"]).json()
    second = client.post(f"{URL}/{original['id']}/revise", headers=engineering["headers"]).json()
    assert client.get(URL).json()["total"] == 1
    for revision in (first, second):
        write = {
            key: revision[key] for key in ("title", "serial_nos", "steps", "review_note", "version")
        }
        write["review_note"] = ""  # Saving engineering no longer requires an approval conclusion.
        write["modified_employee_id"] = engineering["people"][0]["id"]
        response = client.put(f"{URL}/{revision['id']}", headers=engineering["headers"], json=write)
        assert response.status_code == 200, response.text
        revision["version"] = response.json()["version"]
    saved = client.post(
        f"{URL}/{first['id']}/publish",
        headers=engineering["headers"],
        json={"version": first["version"]},
    )
    assert saved.status_code == 200, saved.text
    listing = client.get(URL).json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == first["id"]
    assert client.get(f"{URL}/{original['id']}").json()["steps"] == original["steps"]
    stale = client.post(
        f"{URL}/{second['id']}/publish",
        headers=engineering["headers"],
        json={"version": second["version"]},
    )
    assert stale.status_code == 409
    assert (
        client.post(f"{URL}/{original['id']}/revise", headers=engineering["headers"]).status_code
        == 409
    )
