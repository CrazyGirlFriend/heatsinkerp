"""Header filters compose before totals and pagination, including shared orders."""

from datetime import datetime
from decimal import Decimal

from app.database import SessionLocal
from app.models import MaterialTransfer, SharedMaterialGroup, SharedMaterialMember
from test_material_transfers import _team


def test_column_filters_intersect_before_pagination_and_preserve_shared_serial_search(client):
    teams = [
        _team(client, code, name)
        for code, name in (("ROLL", "轧制"), ("QA", "检验"), ("CUT", "线切割"))
    ]
    with SessionLocal() as db:
        group = SharedMaterialGroup(
            batch_no="SHARED-ORIGIN", members=[SharedMaterialMember(serial_no="YS%_!001")]
        )
        db.add(group)
        db.flush()
        common = dict(
            serial_no="YS%_!001",
            material_name="W80",
            material_type="semi_finished",
            source_team_id=teams[0]["id"],
            source_team_code="ROLL",
            source_team_name="轧制",
            next_team_id=teams[1]["id"],
            next_team_code="QA",
            next_team_name="检验",
            quantity=20,
            weight=Decimal("1.352"),
            purpose_name="检验业务1",
            status="pending",
            created_at=datetime(2026, 10, 13, 2),
            created_by="测试",
        )
        for index, override in enumerate(
            [
                {},
                {
                    "serial_no": "SHARED",
                    "shared_group_id": group.id,
                    "shared_unallocated": True,
                    "status": "received",
                },
                {"serial_no": "YSAA001"},
                {"material_name": "T1"},
                {"purpose_name": "检验业务2"},
                {"quantity": 21},
                {"weight": Decimal("1.353")},
                {"status": "voided"},
                {"next_team_id": teams[2]["id"]},
                {"created_at": datetime(2026, 10, 12, 2)},
                {"material_type": "raw_material"},
                {"source_team_id": teams[1]["id"]},
            ]
        ):
            db.add(MaterialTransfer(**{**common, **override}, batch_no=f"TL-COLUMN-{index}"))
        db.commit()
    params = dict(
        serial_query="YS%_!001",
        material_query="W80",
        purpose_query="业务1",
        batch_query="COLUMN",
        quantity_min=20,
        quantity_max=20,
        weight_min="1.352",
        weight_max="1.352",
        source_team_ids=f"{teams[0]['id']},{teams[2]['id']}",
        next_team_ids=str(teams[1]["id"]),
        statuses="pending,received",
        material_types="semi_finished,finished",
        date_from="2026-10-13",
        date_to="2026-10-13",
        page_size=1,
        include_summary=True,
    )
    for page, expected in ((1, "TL-COLUMN-1"), (2, "TL-COLUMN-0"), (3, None)):
        response = client.get("/api/material-transfers", params={**params, "page": page})
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["total"] == 2
        assert [row["batch_no"] for row in result["items"]] == ([expected] if expected else [])
        assert result["summary"] == {
            key: {"quantity": 20, "weight": 1.352} for key in ("received", "pending")
        }
    response = client.get("/api/material-transfers", params={**params, "status": "pending"})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert client.get("/api/material-transfers", params={"quantity_max": "0"}).json()["total"] == 0


def test_invalid_column_filters_are_rejected_as_client_errors(client):
    for params in (
        {"quantity_min": "-1"},
        {"quantity_min": "1.5"},
        {"quantity_max": "2147483648"},
        {"quantity_min": "20", "quantity_max": "10"},
        {"weight_min": "2", "weight_max": "1"},
        {"weight_min": "NaN"},
        {"weight_max": "Infinity"},
        {"weight_min": "0.1234567"},
        {"source_team_ids": "1,foo"},
        {"next_team_ids": "0,2"},
        {"statuses": "pending,bogus"},
        {"material_types": "raw_material,bogus"},
        {"serial_query": "A" * 161},
    ):
        response = client.get("/api/material-transfers", params=params)
        assert response.status_code == 422, (params, response.text)
