"""Real HTTP stock races, restricted to the disposable capacity MySQL database.

Run in the test application or a separate client with --confirm-disposable.
Only loopback/the fixed test alias are accepted, never a production database.
"""

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import json
import os
import secrets
from threading import Barrier
from time import monotonic
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener


class Harness:
    HTTP_HOST = os.environ.get("CAPACITY_HTTP_HOST", "127.0.0.1")

    def __init__(self):
        if not (os.environ.get("APP_ENV") == "test"
                and os.environ.get("MYSQL_HOST") == "validation-db"
                and os.environ.get("MYSQL_DATABASE") == "heatsink_capacity_20260923"):
            raise RuntimeError("Refusing anything except the isolated capacity database")
        if self.HTTP_HOST not in ("127.0.0.1", "validation-app"):
            raise RuntimeError("Refusing a non-test HTTP host")
        from sqlalchemy import func, select
        from app.auth import hash_password
        from app.database import SessionLocal, engine
        from app.models import MaterialTransfer, Team, User

        if engine.dialect.name != "mysql" or engine.url.database != "heatsink_capacity_20260923":
            raise RuntimeError("Refusing a different database connection")
        self.prefix = "http-qa-" + secrets.token_hex(6)
        self.actors = []
        self.Session = SessionLocal
        password = secrets.token_urlsafe(24)
        hashed = hash_password(password)
        with SessionLocal.begin() as db:
            self.teams = list(db.scalars(select(Team.id).where(Team.code.like("FACTORY-%")).order_by(Team.sort_order)))
            assert len(self.teams) == 8
            self.initial_records = db.scalar(select(func.count()).select_from(MaterialTransfer))
            assert self.initial_records >= 433, "Expected the seeded disposable fixture"
            self.users = []
            for index in range(25):
                team = None if index < 2 else self.teams[(index - 2) % 8]
                user = User(username=f"{self.prefix}-{index}", display_name=f"隔离验证 {index}",
                            password_hash=hashed, role="ADMIN" if team is None else "TEAM",
                            team_id=team, active=True)
                db.add(user)
                db.flush()
                self.users.append({"id": user.id, "username": user.username, "team": team})
        try:
            for user in self.users:
                _, data = self.request(None, "/api/auth/login", {"username": user["username"], "password": password})
                assert data["user"]["id"] == user["id"], "HTTP application/database mismatch"
                self.actors.append({**user, "token": data["access_token"]})
        except BaseException:
            self.close()
            raise
        self.warehouse = [a for a in self.actors if a["team"] == self.teams[0]]
        self.receivers = [a for a in self.actors if a["team"] == self.teams[1]]

    @staticmethod
    def request(actor, path, body=None, *, method=None, allowed=(200, 201, 204)):
        headers = {"Content-Type": "application/json"}
        if actor:
            headers["Authorization"] = "Bearer " + actor["token"]
        request = Request("http://" + Harness.HTTP_HOST + ":8000" + path, headers=headers, method=method,
                          data=None if body is None else json.dumps(body).encode())
        try:
            response = build_opener(ProxyHandler({})).open(request, timeout=10)
        except HTTPError as exc:
            response = exc
        with response:
            data = response.read()
            status = response.status
        assert status in allowed, f"{request.method} {path}: HTTP {status}"
        return status, json.loads(data) if data else None

    def key(self, suffix):
        return f"{self.prefix}-{suffix}"

    def receipt(self, name, quantity=100, *, actor=None):
        payload = {"serial_no": self.key(name), "material_name": "铜钼 CuMo70",
                   "material_type": "semi_finished", "quantity": quantity,
                   "weight": str(Decimal(quantity) / 10), "notes": "隔离并发验证",
                   "idempotency_key": self.key(name)}
        return self.request(actor or self.warehouse[0], f"/api/team-materials/{self.teams[0]}/receipts", payload)[1]

    def dispatch(self, actor, lot, key, quantity=60, **extra):
        payload = {"next_team_id": self.teams[1], "idempotency_key": self.key(key),
                   "lines": [{"source_transfer_id": lot["id"], "quantity": quantity,
                              "weight": str(Decimal(quantity) / 10), "material_type": "semi_finished"}], **extra}
        return self.request(actor, f"/api/team-materials/{self.teams[0]}/dispatches", payload, allowed=(201, 409))

    def loss(self, actor, lot, key, quantity=60):
        return self.request(actor, f"/api/team-materials/{self.teams[0]}/losses", {
            "source_transfer_id": lot["id"], "quantity": quantity, "weight": str(Decimal(quantity) / 10),
            "reason": "隔离并发验证", "idempotency_key": self.key(key)}, allowed=(201, 409))

    def confirm(self, actor, line, key):
        return self.request(actor, f"/api/material-transfers/{line['batch_no']}/confirm", {
            "idempotency_key": self.key(key), "expected_version": line["version"]}, allowed=(200, 409))

    @staticmethod
    def race(*operations):
        barrier = Barrier(len(operations))

        def run(operation):
            barrier.wait(timeout=10)
            return operation()

        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(run, operations))

    def balances(self):
        """Independent primitive ledger calculation; no stock_table/cache reuse."""
        from sqlalchemy import select
        from app.models import MaterialLoss, MaterialTransfer as MT

        with self.Session() as db:
            lots = {row.id: row for row in db.execute(select(MT.id, MT.next_team_id, MT.quantity, MT.weight)
                    .where(MT.status == "received", MT.stock_tracked.is_(True)))}
            remaining = {key: [row.quantity, row.weight] for key, row in lots.items()}
            deductions = db.execute(select(MT.source_transfer_id, MT.quantity, MT.weight)
                .where(MT.source_transfer_id.in_(lots), MT.status.in_(["pending", "received", "dispatched"]))).all()
            deductions += db.execute(select(MaterialLoss.source_transfer_id, MaterialLoss.quantity, MaterialLoss.weight)
                                     .where(MaterialLoss.source_transfer_id.in_(lots))).all()
            for source, quantity, weight in deductions:
                remaining[source][0] -= quantity
                remaining[source][1] -= weight
            assert all(q >= 0 and w >= 0 for q, w in remaining.values()), "Negative source balance"
            teams = defaultdict(lambda: [0, Decimal(0)])
            for key, (quantity, weight) in remaining.items():
                teams[lots[key].next_team_id][0] += quantity
                teams[lots[key].next_team_id][1] += weight
        return remaining, teams

    def expect_balance(self, lot, quantity):
        assert self.balances()[0][lot["id"]] == [quantity, Decimal(quantity) / 10]

    def reconcile(self):
        _, teams = self.balances()
        for team in self.teams:
            actor = next(a for a in self.actors if a["team"] == team)
            totals = self.request(actor, f"/api/team-materials/{team}/overview")[1]["totals"]
            assert [totals["on_hand_quantity"], Decimal(str(totals["on_hand_weight"]))] == teams[team]
        report = self.request(self.actors[0], "/api/factory-overview")[1]
        matrix = report["stock_matrix"]
        assert matrix["total"]["quantity"] == sum(v[0] for v in teams.values())
        assert Decimal(str(matrix["total"]["weight"])) == sum(v[1] for v in teams.values())
        return matrix["total"]

    def close(self):
        failures = 0
        for actor in self.actors:
            try:
                self.request(actor, "/api/auth/logout", {})
            except Exception:
                failures += 1
        print(json.dumps({"sessions_revoked": len(self.actors) - failures, "logout_failures": failures}), flush=True)


def run_races(qa):
    results = {}
    # Distinct lots/keys must not contend on a missing idempotency-key gap.
    # This specifically regresses InnoDB REPEATABLE READ next-key deadlocks.
    for name, operation in (("independent_dispatches", qa.dispatch), ("independent_losses", qa.loss)):
        lots = [qa.receipt(name + str(index)) for index in range(8)]
        responses = qa.race(*(lambda index=index: operation(
            qa.warehouse[index % len(qa.warehouse)], lots[index], name + str(index), 10
        ) for index in range(8)))
        assert all(status == 201 for status, _ in responses), name
        for lot in lots:
            qa.expect_balance(lot, 90)
        results[name] = [status for status, _ in responses]
    lots = [qa.receipt(f"bulk-parallel-{index}") for index in range(4)]
    responses = qa.race(*(lambda index=index: qa.dispatch(
        qa.warehouse[index % len(qa.warehouse)], lots[index], f"bulk-parallel-{index}",
        lines=[{"source_transfer_id": lots[index]["id"], "quantity": 1, "weight": ".100"}] * 12,
    ) for index in range(4)))
    assert all(status == 201 and len(data["items"]) == 12 for status, data in responses)
    assert len({item["batch_no"] for _, data in responses for item in data["items"]}) == 48
    for lot in lots:
        qa.expect_balance(lot, 88)
    results["parallel_bulk_dispatches"] = [status for status, _ in responses]
    lot = qa.receipt("duplicate-bulk")
    lines = [{"source_transfer_id": lot["id"], "quantity": 1, "weight": ".100"}] * 12
    responses = qa.race(*(lambda actor=actor: qa.dispatch(
        actor, lot, "duplicate-bulk-out", lines=lines
    ) for actor in qa.warehouse))
    assert all(status == 201 and data == responses[0][1] for status, data in responses)
    qa.expect_balance(lot, 88)
    results["duplicate_bulk_dispatch"] = [status for status, _ in responses]
    lot = qa.receipt("hundred-line-bulk")
    lines = [{"source_transfer_id": lot["id"], "quantity": 1, "weight": ".100"}] * 100
    status, data = qa.dispatch(qa.warehouse[0], lot, "hundred-line-bulk-out", lines=lines)
    assert status == 201 and len({item["batch_no"] for item in data["items"]}) == 100
    assert qa.dispatch(qa.warehouse[0], lot, "hundred-line-bulk-out", lines=lines) == (status, data)
    qa.expect_balance(lot, 0)
    results["hundred_line_bulk_replay"] = status
    first = data["items"][0]
    assert qa.confirm(qa.receivers[0], first, "hundred-line-confirm")[0] == 200
    qa.request(qa.actors[0], "/api/serial-urgency", {
        "serial_no": lot["serial_no"].upper(), "urgent": True,
        "reason": "隔离批量重试验证", "expected_version": 0,
    }, method="PUT")
    replay_status, replay = qa.dispatch(qa.warehouse[0], lot, "hundred-line-bulk-out", lines=lines)
    assert replay_status == 201 and replay["items"][0]["status"] == "received"
    assert replay["items"][0]["allowed_actions"] == []
    assert all(item["urgency"]["urgent"] for item in replay["items"])
    assert all(item["status"] == "pending" for item in replay["items"][1:])
    qa.expect_balance(lot, 0)
    qa.expect_balance(first, 1)
    results["bulk_replay_latest_state_and_collation"] = replay_status
    lot = qa.receipt("receipt-replay-loss")
    assert qa.loss(qa.warehouse[0], lot, "receipt-replay-loss-record", 1)[0] == 201
    retried_receipt = qa.receipt("receipt-replay-loss")
    assert retried_receipt["id"] == lot["id"]
    assert len(retried_receipt["loss_records"]) == 1
    assert [event["action"] for event in retried_receipt["history"]] == ["stocked"]
    qa.expect_balance(lot, 99)
    results["receipt_replay_latest_loss"] = "passed"
    lot = qa.receipt("casefolded-urgency")
    qa.request(qa.actors[0], "/api/serial-urgency", {
        "serial_no": lot["serial_no"].upper(), "urgent": True,
        "reason": "隔离大小写匹配验证", "expected_version": 0,
    }, method="PUT")
    status, data = qa.dispatch(qa.warehouse[0], lot, "casefolded-urgency-out", 1)
    assert status == 201 and data["items"][0]["urgency"]["urgent"]
    assert qa.dispatch(qa.warehouse[0], lot, "casefolded-urgency-out", 1) == (status, data)
    results["collation_preserved_in_bulk_response"] = status
    for name, operations in (("dispatch_vs_dispatch", (qa.dispatch, qa.dispatch)),
                             ("loss_vs_dispatch", (qa.loss, qa.dispatch)),
                             ("loss_vs_loss", (qa.loss, qa.loss))):
        lot = qa.receipt(name)
        raced = qa.race(*(lambda i=i, op=op: op(qa.warehouse[i], lot, f"{name}-{i}")
                         for i, op in enumerate(operations)))
        assert sorted(r[0] for r in raced) == [201, 409], name
        qa.expect_balance(lot, 40)
        results[name] = [r[0] for r in raced]
    for name, operation in (("duplicate_dispatch", qa.dispatch), ("duplicate_loss", qa.loss)):
        lot = qa.receipt(name)
        raced = qa.race(*(lambda actor=actor: operation(actor, lot, name, 100) for actor in qa.warehouse))
        assert all(r[0] == 201 and r[1] == raced[0][1] for r in raced), name
        qa.expect_balance(lot, 0)
        results[name] = [r[0] for r in raced]
    for name, same_key in (("duplicate_confirm", True), ("competing_confirm", False)):
        lot = qa.receipt(name)
        line = qa.dispatch(qa.warehouse[0], lot, name + "-out", 100)[1]["items"][0]
        raced = qa.race(*(lambda i=i, actor=actor: qa.confirm(actor, line, name if same_key else f"{name}-{i}")
                         for i, actor in enumerate(qa.receivers)))
        assert sorted(r[0] for r in raced) == ([200] * len(raced) if same_key else [200] + [409] * (len(raced) - 1)), name
        qa.expect_balance(lot, 0)
        qa.expect_balance(line, 100)
        from sqlalchemy import func, select
        from app.models import MaterialTransferEvent
        with qa.Session() as db:
            assert db.scalar(select(func.count()).select_from(MaterialTransferEvent).where(
                MaterialTransferEvent.transfer_id == line["id"], MaterialTransferEvent.action == "received")) == 1
        results[name] = [r[0] for r in raced]
    first, second = qa.receipt("atomic-a"), qa.receipt("atomic-b")
    qa.loss(qa.warehouse[0], second, "atomic-loss", 95)
    status, _ = qa.dispatch(qa.warehouse[0], first, "atomic-failure", lines=[
        {"source_transfer_id": lot["id"], "quantity": 10, "weight": "1.000"} for lot in (first, second)])
    assert status == 409
    qa.expect_balance(first, 100)
    qa.expect_balance(second, 5)
    from sqlalchemy import func, select
    from app.models import MaterialDispatch
    with qa.Session() as db:
        assert db.scalar(select(func.count()).select_from(MaterialDispatch).where(
            MaterialDispatch.idempotency_key == qa.key("atomic-failure"))) == 0
    results["multi_lot_rollback"] = status
    lot = qa.receipt("void-vs-confirm")
    line = qa.dispatch(qa.warehouse[0], lot, "void-vs-confirm-out", 100)[1]["items"][0]
    raced = qa.race(lambda: qa.request(qa.warehouse[0], f"/api/material-transfers/{line['batch_no']}",
                                     method="DELETE", allowed=(204, 409)),
                    lambda: qa.confirm(qa.receivers[0], line, "void-vs-confirm-in"))
    assert [r[0] for r in raced] in ([204, 409], [409, 200])
    qa.expect_balance(lot, 100 if raced[0][0] == 204 else 0)
    results["void_vs_confirm"] = [r[0] for r in raced]
    print(json.dumps({"http_concurrency": "passed", "scenarios": results, "reconciled": qa.reconcile()}), flush=True)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-disposable", action="store_true", required=True)
    parser.parse_args()
    started = monotonic()
    harness = Harness()
    try:
        run_races(harness)
    finally:
        harness.close()
    print(json.dumps({"seconds": round(monotonic() - started, 1), "production_business_writes": 0}), flush=True)
