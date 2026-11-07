"""Imported teams and processing remain usable without route execution presets."""

from app.database import SessionLocal
from app.models import ProcessRoute
from sqlalchemy import func, select
from test_process_route_import import HEADERS, docx
from test_process_route_intake import publish_payload, route_payload
from test_processing_daily import work
from test_warehouse_classification import base, confirm, dispatch
from test_warehouse_receipts import intake
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def test_word_maps_every_known_operation_to_its_active_team(client, warehouse):
    teams = {"库房": warehouse["team"], "轧制": warehouse["other"]}
    for suffix, name in (
        ("WIRE", "线切割"),
        ("ANNEAL", "退火"),
        ("GRIND", "研磨"),
        ("QC", "检验"),
        ("ENGRAVE", "雕刻"),
        ("PLATE", "电镀"),
    ):
        response = client.post(
            "/api/teams", json={"code": f"FACTORY-{suffix}", "name": name, "kind": "production"}
        )
        assert response.status_code == 201, response.text
        teams[name] = response.json()
    operations = [
        "中转库",
        "线切割",
        "退火",
        "研磨",
        "退火",
        "质检",
        "研磨",
        "轧板",
        "质检",
        "雕刻",
        "电镀",
        "待定工序",
    ]
    word = docx(
        [["流水号", "691236-50"], HEADERS]
        + [[i, name, "按原稿要求加工", "1", "4008"] for i, name in enumerate(operations)]
    )
    response = client.post("/api/process-routes/parse", files={"file": ("工艺.docx", word)})
    assert response.status_code == 200, response.text
    steps = response.json()["steps"]
    assert [step["name"] for step in steps] == operations
    aliases = {"中转库": "库房", "轧板": "轧制", "质检": "检验"}
    for name, step in zip(operations[:-1], steps[:-1], strict=True):
        team = teams[aliases.get(name, name)]
        assert step["team_id"] == team["id"]
        assert step["team_name"] == team["name"]
    assert steps[-1]["team_id"] is None
    disabled = teams["电镀"]
    assert client.patch(f"/api/teams/{disabled['id']}", json={"active": False}).status_code == 200
    reparsed = client.post("/api/process-routes/parse", files={"file": ("工艺.docx", word)})
    assert reparsed.status_code == 200, reparsed.text
    assert reparsed.json()["steps"][-2]["team_id"] is None
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ProcessRoute.id))) == 0


def test_route_without_presets_keeps_actual_task_and_business_registration(client, warehouse):
    s = warehouse
    assert (
        client.patch(f"/api/teams/{s['other']['id']}", json={"code": "FACTORY-GRIND"}).status_code
        == 200
    )
    payload = route_payload(client, s)
    task_id = payload["steps"][1]["processing_task_id"]
    task = next(
        item
        for item in client.get(base(s, True) + "/processing-tasks").json()
        if item["id"] == task_id
    )
    purpose_id = task["purpose_id"]
    payload["steps"][1].update(processing_task_id=None, purpose_id=None)
    payload = publish_payload(client, payload)
    assert payload["steps"][1]["processing_task_id"] is None
    receipt = intake(client, s, process_route=payload, quantity=10, weight=100)
    assert receipt.status_code == 201, receipt.text
    sent = dispatch(
        client,
        s,
        [
            {
                "source_transfer_id": receipt.json()["id"],
                "quantity": 10,
                "weight": 100,
                "purpose_id": purpose_id,
            }
        ],
    )
    assert sent.status_code == 201, sent.text
    assert confirm(client, s, sent.json(), workshop=True).status_code == 200
    lot = sent.json()["items"][0]
    worker = client.get(base(s, True) + "/employees").json()[0]
    missing = work(client, s, lot, worker)
    assert missing.status_code == 422, missing.text
    assert "加工任务" in missing.text
    response = work(client, s, lot, worker, processing_task_id=task_id, purpose_id=purpose_id)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["processing_task_id"] == task_id
    assert result["purpose_id"] == purpose_id
    assert result["process_step_instructions"] == payload["steps"][1]["instructions"]
    assert result["processor_employee_id"] == worker["id"]
