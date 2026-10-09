"""Suggestions identify each serial once and never copy batch quantities."""

from test_material_transfers import _create, _setup_three_teams


def test_serial_suggestions_use_latest_profile_without_duplicate_serials(client):
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
    latest_batch = response.json()["batch_no"]
    response = client.get(
        "/api/material-input-suggestions",
        params={"field": "serial_no", "query": "SERIAL"},
        headers=setup["source_headers"],
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["details"]["material_name"] == "材料1"
    assert items[0]["source_batch_no"] == latest_batch
    assert all(item["value"] == "SERIAL-001" and item["source_batch_no"] for item in items)
    assert all(
        not {"quantity", "weight", "delivery_date", "source_transfer_id", "material_type"}
        & item["details"].keys()
        for item in items
    )


def test_exact_serial_is_not_hidden_by_newer_similar_values(client):
    setup = _setup_three_teams(client)
    for index, serial in enumerate(["YS-007", "YS-007-1", "YS-007-2"]):
        response = _create(client, setup, idempotency_key=f"exact-{index}", serial_no=serial)
        assert response.status_code == 201, response.text
    response = client.get("/api/material-input-suggestions?field=serial_no&query=YS-007&limit=1")
    assert response.status_code == 200, response.text
    assert [item["value"] for item in response.json()["items"]] == ["YS-007"]


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
