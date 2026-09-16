#!/usr/bin/env python3
"""Non-mutating smoke checks for the deployed phase-one transfer workflow.

Required environment variables:

- ``HEATSINK_ACCESS_PASSWORD``
- ``HEATSINK_ADMIN_PASSWORD``
- ``HEATSINK_TEAM_PASSWORD`` (shared password for the selected demo leaders)

The script reads the explicit ``DEMO-DIRECT-FLOW-001`` showcase.  It sends
write requests only where the expected authorization/state rejection occurs
before any data mutation, then verifies that the row count remains unchanged.
Tokens, cookies, passwords and response bodies are never printed.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any

from smoke_client import ApiClient, SmokeFailure, expect_status, require, validate_base_url


DEMO_SERIAL_NO = "DEMO-DIRECT-FLOW-001"
BATCH_PATTERN = re.compile(r"^TL\d{14}$")


def _login(client: ApiClient, username: str, password: str) -> str:
    response = client.request(
        "POST",
        "/api/auth/login",
        payload={"username": username, "password": password},
    )
    expect_status(response, 200, f"Login {username}")
    require(isinstance(response.body, dict), "Login returned an invalid body")
    token = response.body.get("access_token")
    require(isinstance(token, str) and bool(token), "Login did not issue a token")
    return token


def _team_account(accounts: list[dict[str, Any]], team_id: int) -> str:
    matches = [
        row.get("username")
        for row in accounts
        if row.get("role") == "TEAM"
        and row.get("active") is True
        and row.get("team_id") == team_id
    ]
    require(bool(matches) and isinstance(matches[0], str), "Demo team leader is missing")
    return matches[0]


def run_checks(
    base_url: str,
    *,
    access_password: str,
    admin_password: str,
    team_password: str,
) -> int:
    client = ApiClient(base_url)
    tokens: list[str] = []
    passed = 0

    def ok(label: str) -> None:
        nonlocal passed
        passed += 1
        print(f"PASS {passed:02d} {label}", flush=True)

    try:
        health = client.request("GET", "/api/health")
        expect_status(health, 200, "Health")
        require(
            isinstance(health.body, dict)
            and health.body.get("status") == "ok"
            and health.body.get("database") == "ok",
            "Database health is not ready",
        )
        ok("API and database health")

        unlock = client.request(
            "POST", "/api/access/unlock", payload={"password": access_password}
        )
        expect_status(unlock, 200, "Access unlock")
        require(
            isinstance(unlock.body, dict) and unlock.body.get("unlocked") is True,
            "Access gate did not unlock",
        )
        admin_token = _login(client, "admin", admin_password)
        tokens.append(admin_token)
        ok("Access gate and administrator login")

        response = client.request(
            "GET",
            f"/api/material-transfers?serial_no={DEMO_SERIAL_NO}&page=1&page_size=100",
            bearer=admin_token,
        )
        expect_status(response, 200, "Material-transfer trace")
        require(isinstance(response.body, dict), "Trace returned an invalid body")
        rows = response.body.get("items")
        total = response.body.get("total")
        require(isinstance(rows, list) and total == 2 and len(rows) == 2, "Demo trace must contain two batches")
        require([row.get("status") for row in rows] == ["received", "pending"], "Demo states are not received then pending")
        require(
            all(
                isinstance(row, dict)
                and isinstance(row.get("batch_no"), str)
                and BATCH_PATTERN.fullmatch(row["batch_no"])
                and row.get("barcode_type") == "CODE128"
                and row.get("barcode_payload") == row.get("batch_no")
                and row.get("serial_no") == DEMO_SERIAL_NO
                and row.get("quantity") == 24
                and row.get("weight") == 4.8
                and row.get("allowed_actions") == []
                and "work_order_id" not in row
                and "operation_id" not in row
                for row in rows
            ),
            "Demo transfer contract is invalid",
        )
        require(rows[0].get("created_at") <= rows[1].get("created_at"), "Trace is not chronological")
        initial_total = total
        ok("Process-independent two-step demo trace and Code 128 contract")

        accounts_response = client.request("GET", "/api/accounts", bearer=admin_token)
        expect_status(accounts_response, 200, "Account directory")
        require(isinstance(accounts_response.body, list), "Account directory is invalid")
        accounts = accounts_response.body
        first_source_id = rows[0]["source_team"]["id"]
        middle_team_id = rows[0]["next_team"]["id"]
        final_team_id = rows[1]["next_team"]["id"]
        source_username = _team_account(accounts, first_source_id)
        middle_username = _team_account(accounts, middle_team_id)
        target_username = _team_account(accounts, final_team_id)
        ok("Demo transfers are backed by active, team-bound leaders")

        admin_write = client.request(
            "POST",
            "/api/material-transfers",
            payload={
                "serial_no": "SMOKE-ADMIN-DENIED",
                "next_team_id": final_team_id,
                "quantity": 1,
                "weight": 1,
                "idempotency_key": "phase1-smoke-admin-denied",
            },
            bearer=admin_token,
        )
        expect_status(admin_write, 403, "Administrator transfer write")
        ok("Administrator is read-only for transfers")

        source_token = _login(client, source_username, team_password)
        middle_token = _login(client, middle_username, team_password)
        target_token = _login(client, target_username, team_password)
        tokens.extend((source_token, middle_token, target_token))

        first_source = client.request(
            "GET", f"/api/material-transfers/{rows[0]['batch_no']}", bearer=source_token
        )
        expect_status(first_source, 200, "Confirmed source detail")
        require(first_source.body.get("locked") is True and first_source.body.get("allowed_actions") == [], "Confirmed transfer is not locked")
        locked_patch = client.request(
            "PATCH",
            f"/api/material-transfers/{rows[0]['batch_no']}",
            payload={"notes": "must-not-change"},
            bearer=source_token,
        )
        expect_status(locked_patch, 409, "Confirmed transfer edit")
        ok("Confirmed batch is permanently locked")

        middle_detail = client.request(
            "GET", f"/api/material-transfers/{rows[1]['batch_no']}", bearer=middle_token
        )
        target_detail = client.request(
            "GET", f"/api/material-transfers/{rows[1]['batch_no']}", bearer=target_token
        )
        expect_status(middle_detail, 200, "Pending source detail")
        expect_status(target_detail, 200, "Pending target detail")
        require(middle_detail.body.get("allowed_actions") == ["edit", "void"], "Pending source actions are incorrect")
        require(target_detail.body.get("allowed_actions") == ["confirm"], "Pending target action is incorrect")
        forbidden_confirm = client.request(
            "POST",
            f"/api/material-transfers/{rows[1]['batch_no']}/confirm",
            payload={"idempotency_key": "phase1-smoke-wrong-team"},
            bearer=source_token,
        )
        expect_status(forbidden_confirm, 403, "Wrong-team confirmation")
        ok("Source/target permissions and whole-batch confirmation action")

        final_list = client.request(
            "GET",
            f"/api/material-transfers?serial_no={DEMO_SERIAL_NO}&page=1&page_size=100",
            bearer=admin_token,
        )
        expect_status(final_list, 200, "Final trace recheck")
        require(
            final_list.body.get("total") == initial_total
            and [row.get("status") for row in final_list.body.get("items", [])]
            == ["received", "pending"],
            "Smoke checks unexpectedly changed business data",
        )
        ok("Rejected checks left business data unchanged")
    finally:
        for token in tokens:
            try:
                client.request("POST", "/api/auth/logout", bearer=token)
            except Exception:
                pass

    print(f"RESULT {passed}/{passed} passed; no business records changed", flush=True)
    return passed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8082")
    args = parser.parse_args()
    try:
        base_url = validate_base_url(args.base_url)
        access_password = os.environ["HEATSINK_ACCESS_PASSWORD"]
        admin_password = os.environ["HEATSINK_ADMIN_PASSWORD"]
        team_password = os.environ["HEATSINK_TEAM_PASSWORD"]
        run_checks(
            base_url,
            access_password=access_password,
            admin_password=admin_password,
            team_password=team_password,
        )
        return 0
    except KeyError as error:
        print(f"FAIL missing required environment variable: {error.args[0]}", file=sys.stderr)
    except SmokeFailure as error:
        print(f"FAIL {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
