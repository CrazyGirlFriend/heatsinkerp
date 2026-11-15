"""Select real warehouse slots for valid intake/return test fixtures."""

from uuid import uuid4


def select_location(client, setup, *, headers=None):
    name = "测试仓位-" + uuid4().hex[:12]
    response = client.post("/api/warehouse-locations", json={"name": name})
    assert response.status_code == 201, response.text
    key = uuid4().hex
    response = client.post(
        f"/api/warehouse-locations/{response.json()['id']}/reservation",
        headers=headers or setup["headers"],
        json={"key": key},
    )
    assert response.status_code == 200, response.text
    return {"warehouse_location": name, "warehouse_location_reservation_key": key}
