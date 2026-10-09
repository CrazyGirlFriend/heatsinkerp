"""Suggestions keep distinct serial profiles and never copy batch quantities."""

from test_material_transfers import _create, _setup_three_teams


def test_serial_suggestions_group_duplicates_and_keep_alternatives(client):
    setup = _setup_three_teams(client)
    for key, name, spec in [
        ("a", "材料1", "100 × 80 × 5 mm"),
        ("b", "材料2", "Φ20 × 5 mm"),
        ("c", "材料1", "100 × 80 × 5 mm"),
    ]:
        response = _create(
            client, setup, idempotency_key=key, material_name=name, finished_specification=spec
        )
        assert response.status_code == 201, response.text
    response = client.get(
        "/api/material-input-suggestions",
        params={"field": "serial_no", "query": "SERIAL"},
        headers=setup["source_headers"],
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 2
    assert {item["details"]["material_name"] for item in items} == {"材料1", "材料2"}
    assert all(item["value"] == "SERIAL-001" and item["source_batch_no"] for item in items)
    assert all(
        not {"quantity", "weight", "delivery_date", "source_transfer_id", "material_type"}
        & item["details"].keys()
        for item in items
    )


def test_suggestions_escape_wildcards_exclude_voided_and_bound_results(client):
    setup = _setup_three_teams(client)
    for i, serial in enumerate(["YS%_001", "YS1001", "YS2002"]):
        response = _create(
            client, setup, idempotency_key=f"input-{i}", serial_no=serial, material_name=f"材料{i}"
        )
        assert response.status_code == 201, response.text
        if i == 2:
            voided = client.delete(
                f"/api/material-transfers/{response.json()['batch_no']}",
                headers=setup["source_headers"],
            )
            assert voided.status_code == 204, voided.text
    assert (
        len(
            client.get("/api/material-input-suggestions?field=serial_no&query=%25_").json()["items"]
        )
        == 1
    )
    assert (
        len(client.get("/api/material-input-suggestions?field=material_name").json()["items"]) == 2
    )
    assert (
        len(client.get("/api/material-input-suggestions?field=serial_no&limit=1").json()["items"])
        == 1
    )
    assert client.get("/api/material-input-suggestions?field=serial_no&limit=21").status_code == 422
    assert client.get("/api/material-input-suggestions?field=password").status_code == 422
    client.headers.pop("Authorization")
    assert client.get("/api/material-input-suggestions?field=serial_no").status_code == 401
