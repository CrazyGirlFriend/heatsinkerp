"""Display rotation is independent of retained source bytes and engineering writes."""

from io import BytesIO

import pytest
from app.process_route_drawings import drawing_preview
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from test_engineering_team import engineering as engineering  # noqa: F401
from test_process_route_creation import manual, pdf, upload
from test_warehouse_receipts import warehouse as warehouse  # noqa: F401


def drawing(angle=270, page_rotation=0):
    writer = PdfWriter()
    page = writer.add_blank_page(595, 842)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    matrix = {0: "1 0 0 1", 90: "0 1 -1 0", 180: "-1 0 0 -1", 270: "0 -1 1 0"}[angle]
    content = DecodedStreamObject()
    content.set_data(
        f"BT /F1 12 Tf {matrix} 100 600 Tm (Engineering drawing ABC123456789 revision 1) Tj ET".encode()
    )
    page[NameObject("/Contents")] = writer._add_object(content)
    page.rotate(page_rotation)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize("angle", [90, 180, 270])
def test_corrects_clearly_sideways_layout_without_altering_content(angle):
    source = drawing(angle)
    result = drawing_preview(source)
    original, preview = PdfReader(BytesIO(source)), PdfReader(BytesIO(result))
    assert preview.pages[0].rotation == angle
    assert original.pages[0].rotation == 0
    assert preview.pages[0].get_contents().get_data() == original.pages[0].get_contents().get_data()


@pytest.mark.parametrize("angle,rotation", [(0, 0), (270, 270), (90, 90)])
def test_preserves_already_correct_page_direction_exactly(angle, rotation):
    source = drawing(angle, rotation)
    assert drawing_preview(source) == source


def test_does_not_guess_blank_or_mixed_orientation_layouts():
    blank = pdf()
    assert drawing_preview(blank) == blank
    sideways = PdfReader(BytesIO(drawing()))
    upright = PdfReader(BytesIO(drawing(0)))
    stream = DecodedStreamObject()
    stream.set_data(
        sideways.pages[0].get_contents().get_data()
        + b"\n"
        + upright.pages[0].get_contents().get_data()
    )
    writer = PdfWriter()
    writer.append_pages_from_reader(sideways)
    writer.pages[0][NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    original = output.getvalue()
    assert drawing_preview(original) == original


def test_pending_preview_is_read_only_validated_and_keeps_original_download(
    client, warehouse, engineering
):
    source = drawing()
    path = "/api/process-routes/drawing-preview"
    pending = client.post(
        path,
        headers=engineering["headers"],
        files={"file": ("图纸.pdf", source, "application/pdf")},
    )
    assert pending.status_code == 200, pending.text
    assert PdfReader(BytesIO(pending.content)).pages[0].rotation == 270
    assert (
        client.post(
            path, headers=warehouse["headers"], files={"file": ("图纸.pdf", source)}
        ).status_code
        == 403
    )
    assert (
        client.post(
            path, headers=engineering["headers"], files={"file": ("图纸.pdf", b"fake")}
        ).status_code
        == 422
    )
    route = upload(client, manual(client, warehouse, engineering), engineering, source).json()
    stored = f"/api/process-routes/{route['id']}/drawings/{route['drawings'][0]['id']}"
    assert client.get(stored).content == source
    preview = client.get(stored, params={"preview": True})
    assert PdfReader(BytesIO(preview.content)).pages[0].rotation == 270
    assert client.get(stored).content == source
