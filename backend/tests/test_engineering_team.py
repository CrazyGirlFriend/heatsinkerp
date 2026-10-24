"""Engineering owns Word review; warehouse only associates published versions."""

import pytest
from app.database import SessionLocal
from app.models import ProcessRoute, TeamEmployee
from test_material_transfers import _leader
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


@pytest.fixture()
def engineering(client):
    team = client.post(
        "/api/teams", json={"code": "FACTORY-PROCESS", "name": "工艺", "kind": "engineering"}
    )
    assert team.status_code == 201, team.text
    team = team.json()
    _, headers = _leader(client, "process-leader", team["id"])
    people = [
        client.post(
            f"/api/team-materials/{team['id']}/employees", headers=headers, json={"name": name}
        ).json()
        for name in ("工艺张工", "工艺李工")
    ]
    return {"team": team, "headers": headers, "people": people}


def test_engineering_edit_revision_and_warehouse_binding(client, warehouse, engineering):
    from test_process_route_intake import route_payload

    payload = route_payload(client, warehouse)
    write = {key: value for key, value in payload.items() if key != "id"}
    write["engineering_employee_id"] = engineering["people"][0]["id"]
    saved = client.put(URL + f"/{payload['id']}", headers=engineering["headers"], json=write)
    assert saved.status_code == 200, saved.text
    assert saved.json()["engineering_employee_name"] == "工艺张工"
    assert saved.json()["updated_at"]
    published = client.post(
        URL + f"/{payload['id']}/publish",
        headers=engineering["headers"],
        json={"version": saved.json()["version"]},
    )
    assert published.status_code == 200, published.text
    original = published.json()
    body = {key: original[key] for key in payload}
    receipt = intake(client, warehouse, process_route=body)
    assert receipt.status_code == 201, receipt.text
    assert (
        client.put(URL + f"/{payload['id']}", headers=warehouse["headers"], json=write).status_code
        == 403
    )
    revised = client.post(URL + f"/{payload['id']}/revise", headers=engineering["headers"])
    assert revised.status_code == 201, revised.text
    revised = revised.json()
    assert revised["parent_id"] == original["id"]
    assert revised["created_at"] == original["created_at"]
    assert revised["engineering_employee_name"] == "工艺张工"
    revision_write = {key: revised[key] for key in write if key in revised}
    revision_write["review_note"] = "已核对修订"
    revision_write["modified_employee_id"] = engineering["people"][1]["id"]
    revision_write["steps"][1]["instructions"] = "修订后的要求"
    changed = client.put(
        URL + f"/{revised['id']}", headers=engineering["headers"], json=revision_write
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["engineering_employee_name"] == "工艺张工"
    assert changed.json()["modified_employee_name"] == "工艺李工"
    assert changed.json()["updated_at"] >= original["updated_at"]
    assert client.get(URL + f"/{original['id']}").json() == original
    assert client.get(URL, headers=warehouse["headers"]).json()["total"] == 1
    assert client.get(URL, headers=engineering["headers"]).json()["total"] == 1
    # Search targets serial content, even when the file title is unrelated.
    assert (
        client.get(URL, params={"query": "WAREHOUSE-001"}, headers=warehouse["headers"]).json()[
            "total"
        ]
        == 1
    )
    assert client.get(URL, params={"query": "工艺张工"}).json()["total"] == 1
    with SessionLocal() as db:
        assert db.get(ProcessRoute, original["id"]).steps[1]["instructions"] != "修订后的要求"


def test_employee_must_belong_to_engineering_and_be_active(client, warehouse, engineering):
    from test_process_route_intake import route_payload

    payload = route_payload(client, warehouse)
    write = {key: value for key, value in payload.items() if key != "id"}
    with SessionLocal() as db:
        foreign = TeamEmployee(team_id=warehouse["team"]["id"], name="库房员工")
        inactive = TeamEmployee(team_id=engineering["team"]["id"], name="停用工艺员", active=False)
        db.add_all([foreign, inactive])
        db.commit()
        ids = [foreign.id, inactive.id]
    for employee_id in ids:
        assert (
            client.put(
                URL + f"/{payload['id']}",
                headers=engineering["headers"],
                json={**write, "engineering_employee_id": employee_id},
            ).status_code
            == 422
        )
    assert (
        client.post(
            URL + f"/{payload['id']}/publish", headers=engineering["headers"], json={"version": 1}
        ).status_code
        == 422
    )


def test_engineering_roster_and_material_boundaries(client, warehouse, engineering):
    from app.material_transfer_workflow import _active_target
    from fastapi import HTTPException

    with SessionLocal() as db:
        with pytest.raises(HTTPException) as denied:
            _active_target(db, engineering["team"]["id"])
        assert denied.value.status_code == 422
    assert (
        client.get("/api/auth/me", headers=engineering["headers"]).json()["team_kind"]
        == "engineering"
    )
    assert (
        client.put(
            f"/api/team-materials/{engineering['team']['id']}/opening-stock/authorization",
            json={"enabled": True},
        ).status_code
        == 422
    )
    staff = client.get(
        f"/api/team-materials/{engineering['team']['id']}/employees", headers=engineering["headers"]
    )
    assert staff.status_code == 200 and len(staff.json()) == 2
    for payload in (
        {"code": "FAKE", "name": "假工艺", "kind": "engineering"},
        {"code": "FACTORY-PROCESS", "name": "工艺", "kind": "production"},
    ):
        assert client.post("/api/teams", json=payload).status_code == 422


def test_engineering_edit_metadata_is_not_part_of_the_receipt_retry_payload():
    from app.process_route_schemas import RouteDraftWrite, RouteIntakeWrite

    assert {"engineering_employee_id", "modified_employee_id"} <= set(RouteDraftWrite.model_fields)
    assert not {"engineering_employee_id", "modified_employee_id"} & set(
        RouteIntakeWrite.model_fields
    )
