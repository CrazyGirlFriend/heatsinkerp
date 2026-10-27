"""Manual engineering, optional original import, and version-owned drawing restrictions."""

from io import BytesIO
from uuid import uuid4

import pytest
from app.database import SessionLocal
from app.models import ProcessRoute
from pypdf import PdfWriter
from sqlalchemy import func, select
from test_engineering_team import engineering as engineering  # noqa: F401
from test_process_route_import import HEADERS, docx
from test_process_route_intake import route_payload
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401

URL = "/api/process-routes"


def pdf(number=0, *, password=False, script=False):
    writer = PdfWriter()
    writer.add_blank_page(100 + number, 100)
    if password:
        writer.encrypt("secret")
    if script:
        writer.add_js("app.alert('blocked')")
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


def manual(client, warehouse, engineering):
    original = route_payload(client, warehouse)
    body = {key: value for key, value in original.items() if key != "id"}
    body["serial_nos"] = ["MANUAL-" + uuid4().hex]
    body["engineering_employee_id"] = engineering["people"][0]["id"]
    response = client.post(URL, json=body, headers=engineering["headers"])
    assert response.status_code == 201, response.text
    return response.json()


def upload(client, route, engineering, content=None, filename="图纸.pdf", version=None):
    return client.post(
        f"{URL}/{route['id']}/drawings",
        headers=engineering["headers"],
        data={"version": version or route["version"]},
        files={"file": (filename, pdf() if content is None else content, "application/pdf")},
    )


def test_manual_create_publish_without_word_and_original_source_permissions(
    client, warehouse, engineering
):
    route = manual(client, warehouse, engineering)
    assert route["filename"] == "" and route["source_data"]["tables"] == []
    assert client.get(f"{URL}/{route['id']}/source").status_code == 404
    denied = client.post(
        URL,
        json={
            key: route[key] for key in ("title", "version", "serial_nos", "steps", "review_note")
        },
        headers=warehouse["headers"],
    )
    assert denied.status_code == 403
    published = client.post(
        f"{URL}/{route['id']}/publish",
        headers=engineering["headers"],
        json={"version": route["version"]},
    )
    assert published.status_code == 200, published.text
    assert client.get(f"{URL}/{route['id']}", headers=warehouse["headers"]).status_code == 200


def test_word_parse_does_not_create_a_record_and_attach_keeps_edited_form(
    client, warehouse, engineering
):
    word = docx([["流水号", "S-MANUAL"], HEADERS, [0, "中转库", "备料", 0, 1]])
    with SessionLocal() as db:
        before = db.scalar(select(func.count(ProcessRoute.id)))
    parsed = client.post(
        URL + "/parse", headers=engineering["headers"], files={"file": ("工艺.docx", word)}
    )
    assert parsed.status_code == 200, parsed.text
    assert parsed.json()["serial_nos"] == ["S-MANUAL"]
    assert parsed.json()["steps"][0]["team_id"] == warehouse["team"]["id"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ProcessRoute.id))) == before
    assert (
        client.post(
            URL + "/parse", headers=warehouse["headers"], files={"file": ("工艺.docx", word)}
        ).status_code
        == 403
    )
    route = manual(client, warehouse, engineering)
    attached = client.post(
        f"{URL}/{route['id']}/source",
        headers=engineering["headers"],
        data={"version": route["version"]},
        files={"file": ("工艺.docx", word)},
    )
    assert attached.status_code == 200, attached.text
    assert attached.json()["steps"] == route["steps"]
    assert attached.json()["serial_nos"] == route["serial_nos"]
    assert client.get(f"{URL}/{route['id']}/source").content == word
    stale = client.post(
        f"{URL}/{route['id']}/source",
        headers=engineering["headers"],
        data={"version": route["version"]},
        files={"file": ("工艺.docx", word)},
    )
    assert stale.status_code == 409


def test_drawings_access_versions_and_revision_isolation(client, warehouse, engineering):
    route = manual(client, warehouse, engineering)
    result = upload(client, route, engineering)
    assert result.status_code == 201, result.text
    saved = result.json()
    drawing = saved["drawings"][0]
    path = f"{URL}/{route['id']}/drawings/{drawing['id']}"
    assert client.get(path, headers=warehouse["headers"]).status_code == 403
    assert upload(client, route, engineering).status_code == 409
    assert upload(client, saved, engineering).status_code == 422
    assert client.get(f"{URL}/{route['id'] + 100}/drawings/{drawing['id']}").status_code == 404
    published = client.post(
        f"{URL}/{route['id']}/publish",
        headers=engineering["headers"],
        json={"version": saved["version"]},
    )
    assert published.status_code == 200, published.text
    download = client.get(path, headers=warehouse["headers"])
    assert download.status_code == 200 and download.content == pdf()
    assert download.headers["x-content-type-options"] == "nosniff"
    assert download.headers["cache-control"] == "private, no-store"
    assert upload(client, saved, engineering, pdf(1)).status_code == 409
    assert (
        client.delete(
            path, headers=engineering["headers"], params={"version": saved["version"]}
        ).status_code
        == 409
    )
    revision = client.post(f"{URL}/{route['id']}/revise", headers=engineering["headers"]).json()
    assert len(revision["drawings"]) == 1
    revised_drawing = revision["drawings"][0]
    assert revised_drawing["id"] != drawing["id"]
    revised_path = f"{URL}/{revision['id']}/drawings/{revised_drawing['id']}"
    assert client.get(revised_path).content == download.content
    assert (
        client.delete(
            revised_path,
            headers=engineering["headers"],
            params={"version": revision["version"] + 1},
        ).status_code
        == 409
    )
    removed = client.delete(
        revised_path, headers=engineering["headers"], params={"version": revision["version"]}
    )
    assert removed.status_code == 200 and removed.json()["drawings"] == []
    assert client.get(path).content == download.content


@pytest.mark.parametrize(
    "content,filename,status",
    [
        (b"renamed", "fake.pdf", 422),
        (pdf(), "fake.pdf.exe", 422),
        (pdf(password=True), "locked.pdf", 422),
        (pdf(script=True), "script.pdf", 422),
        (pdf() + b"x" * (5 * 1024 * 1024), "large.pdf", 413),
    ],
)
def test_drawing_restrictions_leave_route_unchanged(
    client, warehouse, engineering, content, filename, status
):
    route = manual(client, warehouse, engineering)
    response = upload(client, route, engineering, content, filename)
    assert response.status_code == status, response.text
    unchanged = client.get(f"{URL}/{route['id']}").json()
    assert unchanged["drawings"] == [] and unchanged["version"] == route["version"]


def test_drawing_count_limit_and_cross_route_access(client, warehouse, engineering):
    route = manual(client, warehouse, engineering)
    for number in range(10):
        result = upload(client, route, engineering, pdf(number), f"图纸{number}.pdf")
        assert result.status_code == 201, result.text
        route = result.json()
    assert upload(client, route, engineering, pdf(11)).status_code == 422
    foreign = client.post(
        URL,
        headers=engineering["headers"],
        json={
            **{key: route[key] for key in ("title", "version", "steps", "review_note")},
            "serial_nos": ["FOREIGN-" + uuid4().hex],
        },
    ).json()
    drawing = route["drawings"][0]
    path = f"{URL}/{foreign['id']}/drawings/{drawing['id']}"
    assert client.get(path).status_code == 404
    assert client.delete(path, params={"version": foreign["version"]}).status_code == 404
