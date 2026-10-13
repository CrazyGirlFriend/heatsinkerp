"""Transfer totals describe the entire filtered set, not stock or a single page."""

from datetime import datetime
from decimal import Decimal

import pytest
from app.database import SessionLocal
from app.models import MaterialDispatch, MaterialTransfer, SerialUrgency
from sqlalchemy import select
from test_material_transfers import _team
from test_transfer_list_loading import read_statements

ZERO = {"quantity": 0, "weight": 0}
EXPECTED = {
    "received": {"quantity": 3784, "weight": 1.1341},
    "pending": {"quantity": 2882, "weight": 0.865},
}


@pytest.fixture()
def summary_scope(client):
    source = _team(client, "CARVE", "雕刻")
    target = _team(client, "ANNEAL", "退火")
    with SessionLocal() as db:
        common = {
            "serial_no": "805881-5",
            "material_name": "W80",
            "material_type": "semi_finished",
            "source_team_id": source["id"],
            "source_team_code": source["code"],
            "source_team_name": source["name"],
            "next_team_id": target["id"],
            "next_team_code": target["code"],
            "next_team_name": target["name"],
            "created_at": datetime(2026, 10, 12, 2),
            "created_by": "测试人员",
        }
        samples = [
            ("pending", 2597, "0.78"),
            ("received", 2902, "0.87"),
            ("voided", 2902, "0.8706"),
            ("voided", 2902, "0.8706"),
            ("pending", 285, "0.085"),
            ("received", 657, "0.1971"),
            ("received", 225, "0.067"),
        ]
        for index, (status, quantity, weight) in enumerate(samples):
            db.add(
                MaterialTransfer(
                    **common,
                    batch_no=f"TL-SUM-{index}",
                    status=status,
                    stock_tracked=status == "received",
                    quantity=quantity,
                    weight=Decimal(weight),
                )
            )
        # Each decoy violates one of the intersecting filters.
        for index, override in enumerate(
            [
                {"serial_no": "OTHER"},
                {"material_type": "finished"},
                {"created_at": datetime(2026, 10, 10, 2)},
                {
                    "next_team_id": source["id"],
                    "next_team_code": source["code"],
                    "next_team_name": source["name"],
                },
            ]
        ):
            db.add(
                MaterialTransfer(
                    **{**common, **override},
                    batch_no=f"TL-DECOY-{index}",
                    status="received",
                    quantity=90000,
                    weight=Decimal("90"),
                )
            )
        db.flush()
        origin = db.scalar(select(MaterialTransfer).where(MaterialTransfer.batch_no == "TL-SUM-1"))
        db.add(
            MaterialTransfer(
                **{
                    **common,
                    "source_team_id": target["id"],
                    "source_team_code": target["code"],
                    "source_team_name": target["name"],
                },
                batch_no="TL-PROCESSED",
                entry_kind="processing_output",
                status="received",
                stock_tracked=True,
                source_transfer_id=origin.id,
                quantity=9999,
                weight=1,
            )
        )
        submission = MaterialDispatch(
            source_team_id=source["id"],
            entry_kind="warehouse_outbound",
            external_destination="客户",
            idempotency_key="summary-external",
            request_hash="summary",
            created_by="测试人员",
        )
        db.add(submission)
        db.flush()
        db.add(
            MaterialTransfer(
                **{**common, "next_team_id": None, "next_team_code": None, "next_team_name": None},
                batch_no="TL-EXTERNAL",
                entry_kind="warehouse_outbound",
                status="dispatched",
                external_destination="客户",
                source_transfer_id=origin.id,
                dispatch_id=submission.id,
                quantity=8888,
                weight=2,
            )
        )
        db.add(SerialUrgency(serial_no="805881-5", urgent=True, updated_by="测试人员"))
        db.commit()
    return {
        "query": "805881-5",
        "search_mode": "exact",
        "search_field": "serial_no",
        "source_team_id": source["id"],
        "next_team_id": target["id"],
        "material_type": "semi_finished",
        "date_from": "2026-10-12",
        "date_to": "2026-10-12",
        "urgent_only": True,
        "include_summary": True,
    }


def test_all_filtered_rows_are_aggregated_before_pagination_without_extra_queries(
    client, summary_scope
):
    for page, size in ((1, 1), (3, 2), (1, 100), (999, 10)):
        with read_statements() as statements:
            response = client.get(
                "/api/material-transfers", params={**summary_scope, "page": page, "page_size": size}
            )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["total"] == 7  # The list retains voided rows, but amounts exclude them.
        assert result["summary"] == EXPECTED
        assert len(result["items"]) <= size
        assert len(statements) <= 3
    ordinary = client.get(
        "/api/material-transfers", params={**summary_scope, "include_summary": False}
    )
    assert ordinary.json()["summary"] is None


def test_status_empty_and_column_filters_are_also_applied_to_totals(client, summary_scope):
    for status in ("received", "pending", "voided", "dispatched"):
        response = client.get("/api/material-transfers", params={**summary_scope, "status": status})
        assert response.status_code == 200, response.text
        assert response.json()["summary"] == {
            key: amount if key == status else ZERO for key, amount in EXPECTED.items()
        }
    for query in ("NO-MATCH", "OTHER"):
        response = client.get("/api/material-transfers", params={**summary_scope, "query": query})
        assert response.json()["summary"] == {"received": ZERO, "pending": ZERO}
    filtered = client.get(
        "/api/material-transfers", params={**summary_scope, "quantity_max": 300}
    ).json()
    assert filtered["summary"] == {
        "received": {"quantity": 225, "weight": 0.067},
        "pending": {"quantity": 285, "weight": 0.085},
    }


def test_processing_outputs_and_external_shipments_are_not_signed_receipts(client, summary_scope):
    # Query these decoys directly: neither should become an extra signed receipt.
    for batch, total in (("TL-PROCESSED", 0), ("TL-EXTERNAL", 1)):
        response = client.get(
            "/api/material-transfers",
            params={
                "query": batch,
                "search_field": "batch_no",
                "search_mode": "exact",
                "include_summary": True,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == total
        assert response.json()["summary"] == {"received": ZERO, "pending": ZERO}
    client.headers.pop("Authorization")
    assert client.get("/api/material-transfers", params=summary_scope).status_code == 401
