"""Quality checks and feedback preserve physical stock and production totals."""

from datetime import datetime, timezone

import pytest
from app.database import SessionLocal
from app.models import InspectionProblemType, TeamEmployee
from test_material_transfers import _leader, _team
from test_processing_daily import setup_lot, work
from test_warehouse_classification import base, dispatch
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


@pytest.fixture()
def inspection(client, warehouse):
    s = warehouse
    lot, worker = setup_lot(client, s)
    done = work(client, s, lot, worker)
    assert done.status_code == 201, done.text
    produced = done.json()["outputs"][0]
    qc = _team(client, "FACTORY-QC", "检验")
    _, headers = _leader(client, "qc-leader", qc["id"])
    with SessionLocal() as db:
        person = TeamEmployee(team_id=qc["id"], name="巡检员李师傅")
        problem = InspectionProblemType(team_id=qc["id"], name="表面划伤")
        db.add_all([person, problem])
        db.commit()
        person_id = person.id
        problem_id = problem.id
    context = client.get(base(s, True) + f"/stock/{produced['id']}/quantity-adjustments").json()
    return (
        s,
        produced,
        headers,
        dict(
            source_transfer_id=produced["id"],
            expected_revision=context["revision"],
            inspector_employee_id=person_id,
            checked_at=datetime.now(timezone.utc).isoformat(),
            sample_quantity=5,
            failed_quantity=1,
            methods=["visual"],
            items=["appearance"],
            involved_team_ids=[s["other"]["id"]],
            problem_type_ids=[problem_id],
            idempotency_key="inspection-one",
        ),
    )


def create_check(client, inspection, **overrides):
    _, _, headers, body = inspection
    if overrides.get("failed_quantity") == 0:
        overrides.setdefault("problem_type_ids", [])
    return client.post("/api/inspections", headers=headers, json={**body, **overrides})


def decide(client, headers, row, **extra):
    return client.post(
        f"/api/quality-feedback/{row['id']}/decision",
        headers=headers,
        json=dict(
            expected_version=row["feedback_version"],
            disposition="other",
            status="processing",
            involved_team_ids=[row["team_id"]],
            idempotency_key="decision-one",
            **extra,
        ),
    )


def test_failed_sample_creates_one_shared_problem_without_changing_stock(client, inspection):
    s, lot, headers, body = inspection
    before = client.get(base(s, True) + "/overview").json()["totals"]
    created = create_check(
        client, inspection, involved_team_ids=[s["team"]["id"], s["other"]["id"]]
    )
    assert created.status_code == 201, created.text
    row = created.json()
    assert (
        row["failed_quantity"] == 1 and row["passed_quantity"] == 4 and row["batch_quantity"] == 10
    )
    assert row["status"] == "failed" and not row["blocks_outbound"]
    assert client.get(base(s, True) + "/overview").json()["totals"] == before
    for h in (headers, s["headers"], s["other_headers"]):
        issues = client.get("/api/quality-feedback", headers=h).json()
        assert issues["total"] == 1 and issues["pending_count"] == 1
        assert len(issues["items"][0]["involved_teams"]) == 2
    from app.inventory_events import change_for
    from app.models import InspectionFeedbackEvent

    with SessionLocal() as db:
        change = change_for(
            InspectionFeedbackEvent(inspection_id=row["id"], team_id=s["other"]["id"]), db
        )
        assert change.team_ids == {s["team"]["id"], s["other"]["id"]}
    assert (
        client.get(base(s, True) + "/processing-records").json()["summary"]["completed_quantity"]
        == 10
    )
    assert (
        dispatch(
            client, s, [dict(source_transfer_id=lot["id"], quantity=1, weight=10)], workshop=True
        ).status_code
        == 201
    )


def test_permissions_feedback_decision_and_recheck_are_independent(client, inspection):
    s, lot, headers, body = inspection
    root = create_check(client, inspection).json()
    rid = root["id"]
    response = client.post(
        f"/api/quality-feedback/{rid}/reply",
        headers=s["other_headers"],
        json=dict(
            notes="本班组已核查，待确认处理", expected_version=0, idempotency_key="reply-one"
        ),
    )
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["feedback_status"] == "processing" and row["feedback_version"] == 1
    assert row["involved_teams"][0]["replied"]
    assert decide(client, s["other_headers"], row).status_code == 403
    assert (
        decide(client, {}, row).status_code == 403
    )  # administrator reads but cannot impersonate QC
    assert client.get(f"/api/quality-feedback/{rid}", headers=s["headers"]).status_code == 404
    assert (
        client.get(
            "/api/quality-feedback", headers=s["headers"], params={"team_id": s["other"]["id"]}
        ).json()["total"]
        == 0
    )
    selected = decide(client, headers, row)
    assert selected.status_code == 200, selected.text
    assert selected.json()["feedback_status"] == "processing"
    assert decide(client, headers, row).status_code == 200  # idempotent replay
    assert decide(client, headers, root, notes="stale").status_code == 409
    rechecked = create_check(
        client,
        inspection,
        parent_id=rid,
        failed_quantity=0,
        involved_team_ids=[],
        idempotency_key="recheck",
    )
    assert rechecked.status_code == 201, rechecked.text
    saved = client.get(f"/api/quality-feedback/{rid}", headers=headers).json()
    assert saved["failed_quantity"] == 1 and saved["feedback_status"] == "processing"
    assert len(saved["rechecks"]) == 1 and saved["rechecks"][0]["failed_quantity"] == 0
    assert client.get("/api/quality-feedback", headers=headers).json()["total"] == 1


@pytest.mark.parametrize(
    "change",
    [
        dict(sample_quantity=0),
        dict(sample_quantity=11),
        dict(failed_quantity=6),
        dict(inspector_employee_id=99999),
        dict(expected_revision=999),
        dict(checked_at="2099-01-01T00:00:00Z"),
        dict(checked_at="2026-10-19T00:00:00"),
        dict(scope="full", sample_quantity=5),
        dict(methods=[]),
        dict(items=[]),
        dict(methods=["visual", "visual"]),
        dict(involved_team_ids=[]),
        dict(involved_team_ids=[99999]),
        dict(kind="inspection"),
        dict(blocks_outbound=True),
    ],
)
def test_invalid_inspection_cannot_write_stock_or_feedback(client, inspection, change):
    response = create_check(client, inspection, **change)
    assert response.status_code in (422, 409), response.text
    assert client.get("/api/inspections").json()["total"] == 0
    assert client.get("/api/quality-feedback").json()["total"] == 0


def test_formal_qc_full_inspection_does_not_require_processing_or_create_output(client, warehouse):
    s = warehouse
    lot, worker = setup_lot(client, s, "FACTORY-QC")
    problem = client.post(
        f"/api/team-materials/{s['other']['id']}/inspection-problems",
        headers=s["other_headers"],
        json={"name": "尺寸超差"},
    )
    assert problem.status_code == 201, problem.text
    context = client.get(base(s, True) + f"/stock/{lot['id']}/quantity-adjustments").json()
    before = client.get(base(s, True) + "/overview").json()["totals"]
    sources = client.get(
        "/api/inspections/sources", params={"team_id": s["other"]["id"], "kind": "inspection"}
    ).json()
    assert sources["items"][0]["source_transfer_id"] == lot["id"]
    grouped = client.get(
        "/api/inspections/sources",
        params={"team_id": s["other"]["id"], "kind": "inspection", "group_id": lot["id"]},
    )
    assert grouped.status_code == 200, grouped.text
    assert grouped.json()["items"] == sources["items"]
    assert (
        client.get(
            "/api/inspections/sources",
            params={"team_id": s["other"]["id"], "kind": "inspection", "group_id": 99999},
        ).status_code
        == 404
    )
    payload = dict(
        source_transfer_id=lot["id"],
        expected_revision=context["revision"],
        inspector_employee_id=worker["id"],
        checked_at=datetime.now(timezone.utc).isoformat(),
        sample_quantity=10,
        failed_quantity=2,
        problem_type_ids=[problem.json()["id"]],
        kind="inspection",
        scope="full",
        methods=["visual", "microscope"],
        items=["appearance", "dimension", "weight"],
        dimension_result="要求30±0.1 mm，实测30.2 mm",
        weight_result="要求10 kg，实测9.9 kg",
        involved_team_ids=[s["team"]["id"]],
        idempotency_key="qc-full",
    )
    response = client.post("/api/inspections", headers=s["other_headers"], json=payload)
    assert response.status_code == 201, response.text
    assert (
        client.post("/api/inspections", headers=s["other_headers"], json=payload).json()
        == response.json()
    )
    assert response.json()["passed_quantity"] == 8
    assert client.get(base(s, True) + "/overview").json()["totals"] == before
    assert client.get(base(s, True) + "/processing-records").json()["total"] == 0
    trace = client.get("/api/material-trace", params={"serial_no": lot["batch_no"]}).json()
    batch = next(r for r in trace["items"] if r["id"] == lot["id"])
    assert batch["inspection_status"] == "failed" and batch["inspection_sample_quantity"] == 10
    external = dispatch(
        client,
        s,
        [dict(source_transfer_id=lot["id"], quantity=1, weight=10)],
        workshop=True,
        idempotency_key="qc-manual-shipment",
        entry_kind="inspection_shipment",
        next_team_id=None,
        external_destination="库房成品",
    )
    assert external.status_code == 201, external.text


def test_only_qc_can_register_and_employee_must_belong_to_qc(client, inspection):
    s, lot, headers, body = inspection
    assert client.post("/api/inspections", headers=s["other_headers"], json=body).status_code == 403
    assert client.post("/api/inspections", json=body).status_code == 403
    other = client.get(base(s, True) + "/employees").json()[0]
    assert create_check(client, inspection, inspector_employee_id=other["id"]).status_code == 422
    fresh, worker = setup_lot(client, s, idempotency_key="unworked")
    ctx = client.get(base(s, True) + f"/stock/{fresh['id']}/quantity-adjustments").json()
    assert (
        create_check(
            client, inspection, source_transfer_id=fresh["id"], expected_revision=ctx["revision"]
        ).status_code
        == 422
    )


def test_feedback_filters_dates_and_paging(client, inspection):
    s, lot, headers, body = inspection
    assert create_check(client, inspection).status_code == 201
    for params, total in [
        ({"kind": "patrol"}, 1),
        ({"kind": "inspection"}, 0),
        ({"status": "pending"}, 1),
        ({"query": lot["batch_no"]}, 1),
        ({"query": "%"}, 0),
        ({"date_from": "2099-01-01"}, 0),
    ]:
        r = client.get("/api/quality-feedback", headers=headers, params=params)
        assert r.status_code == 200, r.text
        assert r.json()["total"] == total
    assert (
        client.get("/api/quality-feedback", params={"page": 2, "page_size": 1}).json()["items"]
        == []
    )
    assert (
        client.get(
            "/api/quality-feedback", params={"date_from": "2026-10-02", "date_to": "2026-10-01"}
        ).status_code
        == 422
    )


def test_legacy_hold_requires_explicit_qc_release_not_a_passing_recheck(client, inspection):
    from app.models import MaterialInspection

    s, lot, headers, body = inspection
    root = create_check(client, inspection).json()
    with SessionLocal() as db:
        db.get(MaterialInspection, root["id"]).blocks_outbound = True
        db.commit()
    lines = [dict(source_transfer_id=lot["id"], quantity=1, weight=10)]
    assert dispatch(client, s, lines, workshop=True).status_code == 409
    passed = create_check(
        client,
        inspection,
        parent_id=root["id"],
        failed_quantity=0,
        involved_team_ids=[],
        idempotency_key="pass-no-release",
    )
    assert passed.status_code == 201, passed.text
    assert dispatch(client, s, lines, workshop=True).status_code == 409
    release = decide(client, headers, root, release_legacy_hold=True)
    assert release.status_code == 200, release.text
    assert dispatch(client, s, lines, workshop=True).status_code == 201
