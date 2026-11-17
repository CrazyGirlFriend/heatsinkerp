"""Reconcile owned stock through the active team overview contract."""

from decimal import Decimal


def team_balances(client):
    response = client.get("/api/teams")
    assert response.status_code == 200, response.text
    balances = {}
    for team in response.json():
        result = client.get(f"/api/team-materials/{team['id']}/overview")
        assert result.status_code == 200, result.text
        balances[team["id"]] = result.json()["totals"]
    return balances


def owned_total(client):
    balances = team_balances(client).values()
    return {
        "quantity": sum(row["owned_quantity"] for row in balances),
        "weight": float(sum((Decimal(str(row["owned_weight"])) for row in balances), Decimal(0))),
    }
