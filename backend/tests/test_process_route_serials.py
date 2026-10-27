"""Normal engineering serials are identities; revisions and rework keep their history."""

from app.database import SessionLocal
from app.models import ProcessRoute, ProcessRouteSerial
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_engineering_team import engineering as engineering  # noqa: F401
from test_process_route_creation import manual
from test_process_route_import import HEADERS, docx
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def body(route, serial=None):
    value = {key: route[key] for key in ("title", "serial_nos", "version", "steps", "review_note")}
    value["review_note"] = value["review_note"] or ""
    if serial is not None:
        value["serial_nos"] = [serial]
    return value


def test_duplicate_create_and_import_share_the_same_reservation(client, warehouse, engineering):
    route = manual(client, warehouse, engineering)
    serial = route["serial_nos"][0]
    with SessionLocal() as db:
        count = db.scalar(select(func.count()).select_from(ProcessRoute))
    for variant in (serial, "  " + serial.lower() + "  "):
        response = client.post(URL, headers=engineering["headers"], json=body(route, variant))
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "duplicate_process_route_serial"
    word = docx([["流水号", serial], HEADERS, [0, "中转库", "备料", 0, 1]])
    imported = client.post(
        URL + "/import", headers=engineering["headers"], files={"file": ("重复.docx", word)}
    )
    assert imported.status_code == 409, imported.text
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ProcessRoute)) == count
        assert db.get(ProcessRouteSerial, serial.casefold()).route_id == route["id"]


def test_edit_cannot_take_another_serial_and_revisions_share_the_original_identity(
    client, warehouse, engineering
):
    first = manual(client, warehouse, engineering)
    # The template helper creates a vocabulary once per fixture; clone a new identity instead.
    second = client.post(
        URL, headers=engineering["headers"], json=body(first, first["serial_nos"][0] + "-B")
    ).json()
    failed = client.put(
        URL + f"/{second['id']}",
        headers=engineering["headers"],
        json=body(second, first["serial_nos"][0]),
    )
    assert failed.status_code == 409, failed.text
    assert client.get(URL + f"/{second['id']}").json()["serial_nos"] == second["serial_nos"]
    saved = client.post(
        URL + f"/{first['id']}/publish",
        headers=engineering["headers"],
        json={"version": first["version"]},
    )
    assert saved.status_code == 200, saved.text
    revision = client.post(URL + f"/{first['id']}/revise", headers=engineering["headers"]).json()
    write = body(revision)
    write["modified_employee_id"] = engineering["people"][0]["id"]
    updated = client.put(URL + f"/{revision['id']}", headers=engineering["headers"], json=write)
    assert updated.status_code == 200, updated.text
    published = client.post(
        URL + f"/{revision['id']}/publish",
        headers=engineering["headers"],
        json={"version": updated.json()["version"]},
    )
    assert published.status_code == 200, published.text
    with SessionLocal() as db:
        assert db.get(ProcessRouteSerial, first["serial_nos"][0].casefold()).route_id == first["id"]
    assert client.get(URL + f"/{first['id']}").json()["serial_nos"] == first["serial_nos"]


def test_database_key_blocks_a_duplicate_when_the_initial_lookup_misses(
    client, warehouse, engineering, monkeypatch
):
    route = manual(client, warehouse, engineering)
    original_get = Session.get

    def concurrent_lookup(session, entity, *args, **kwargs):
        if entity is ProcessRouteSerial:
            return None
        return original_get(session, entity, *args, **kwargs)

    with SessionLocal() as db:
        before = db.scalar(select(func.count()).select_from(ProcessRoute))
    with monkeypatch.context() as patch:
        patch.setattr(Session, "get", concurrent_lookup)
        response = client.post(URL, headers=engineering["headers"], json=body(route))
    assert response.status_code == 409, response.text
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ProcessRoute)) == before
        assert db.get(ProcessRouteSerial, route["serial_nos"][0].casefold()).route_id == route["id"]


def test_legacy_duplicate_is_reserved_without_deleting_history(client, warehouse, engineering):
    route = manual(client, warehouse, engineering)
    key = route["serial_nos"][0].casefold()
    with SessionLocal.begin() as db:
        db.get(ProcessRouteSerial, key).route_id = None
    response = client.post(URL, headers=engineering["headers"], json=body(route))
    assert response.status_code == 409 and "历史重复" in response.text
    assert client.get(URL + f"/{route['id']}").status_code == 200
