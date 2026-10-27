"""Archived duplicates remain readable but cannot replace the selected current route."""

from app.database import SessionLocal
from app.models import ProcessRoute, ProcessRouteArchive
from test_engineering_team import engineering as engineering  # noqa: F401
from test_process_route_creation import manual
from test_process_route_serials import body
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def test_archives_stay_out_of_the_current_list_with_originals_preserved(
    client, warehouse, engineering
):
    current = manual(client, warehouse, engineering)
    with SessionLocal.begin() as db:
        old = ProcessRoute(
            title="旧工艺",
            filename="旧工艺.docx",
            source_sha256="old",
            source_file=b"original",
            source_data={"tables": [], "issues": []},
            serial_nos=current["serial_nos"],
            steps=current["steps"],
            created_by="admin",
        )
        db.add(old)
        db.flush()
        old_id = old.id
        db.add(ProcessRouteArchive(route_id=old_id, current_route_id=current["id"]))
    query = {"query": current["serial_nos"][0]}
    listing = client.get(URL, params=query).json()
    assert [row["id"] for row in listing["items"]] == [current["id"]]
    legacy_query = client.get(
        URL, params={**query, "history": True}, headers=engineering["headers"]
    ).json()
    assert [row["id"] for row in legacy_query["items"]] == [current["id"]]
    original = client.get(f"{URL}/{old_id}").json()
    assert (
        client.put(
            f"{URL}/{old_id}", headers=engineering["headers"], json=body(original)
        ).status_code
        == 409
    )
    assert client.post(f"{URL}/{old_id}/revise", headers=engineering["headers"]).status_code == 409
    assert (
        client.get(f"{URL}/{old_id}/source", headers=engineering["headers"]).content == b"original"
    )
    assert client.post(URL, headers=engineering["headers"], json=body(current)).status_code == 409
