"""Receipt autofill never turns an order/process plan into physical stock."""

from io import BytesIO
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from app import process_route_import as parser
from fastapi import HTTPException

HEADERS = ["序号", "工序名称", "工艺要求", "计划完成天数", "计划加工数量"]
PROCESS = [HEADERS, [0, "中转库", "备料", "0", "226"], [1, "线切割", "按图加工", "7", "4008"]]
CONTENT_TYPES = (
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)
ROOT_RELS = (
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
    ' Target="word/document.xml"/></Relationships>'
)


def docx(rows, *, parts=None, xml=None):
    table = "".join(
        "<w:tr>"
        + "".join(
            "<w:tc><w:p><w:r><w:t>" + escape(str(cell)) + "</w:t></w:r></w:p></w:tc>"
            for cell in row
        )
        + "</w:tr>"
        for row in rows
    )
    xml = xml or (
        '<w:document xmlns:w="'
        + parser.NS["w"]
        + '"><w:body><w:tbl>'
        + table
        + "</w:tbl></w:body></w:document>"
    )
    stream = BytesIO()
    with ZipFile(stream, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", xml)
        package_parts = {"[Content_Types].xml": CONTENT_TYPES, "_rels/.rels": ROOT_RELS}
        package_parts.update(parts or {})
        for name, value in package_parts.items():
            if value is not None:
                archive.writestr(name, value)
    return stream.getvalue()


def values(result):
    return {key: item["value"] for key, item in result[0]["receipt_fields"].items()}


@pytest.mark.parametrize(
    "parts",
    [
        {"[Content_Types].xml": None},
        {"_rels/.rels": None},
        {
            "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
        },
        {"_rels/.rels": ROOT_RELS.replace('/officeDocument"', '/notADocument"')},
        {
            "_rels/.rels": ROOT_RELS.replace("<Relationships xmlns=", "<WrongRoot xmlns=").replace(
                "</Relationships>", "</WrongRoot>"
            )
        },
        {
            "[Content_Types].xml": CONTENT_TYPES.replace(
                "wordprocessingml.document.main+xml", "spreadsheetml.sheet.main+xml"
            )
        },
        {
            "[Content_Types].xml": CONTENT_TYPES.replace(
                "wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml"
            )
        },
        {
            "[Content_Types].xml": CONTENT_TYPES.replace(
                "</Types>",
                '<Override PartName="/word/document.xml" ContentType="application/xml"/></Types>',
            )
        },
    ],
)
def test_incomplete_or_wrong_opc_packages_are_rejected(parts):
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(docx(PROCESS, parts=parts))
    assert exc.value.status_code == 422


def test_valid_word_without_optional_document_relationships_is_supported():
    content = docx([["流水号", "VALID-WORD"], *PROCESS])
    with ZipFile(BytesIO(content)) as archive:
        assert "word/_rels/document.xml.rels" not in archive.namelist()
    assert values(parser.parse_docx(content))["serial_no"] == "VALID-WORD"


def test_identical_rows_with_the_same_sequence_remain_distinct_source_rows():
    content = docx(
        [
            ["流水号", "691236-50"],
            HEADERS,
            [6, "研磨", "按图加工", "7", "4008.00"],
            [7, "轧板", "小拉丝机(80目)拉面。", "7", "4008.00"],
            [7, "轧板", "小拉丝机(80目)拉面。", "7", "4008.00"],
        ]
    )
    data, _, steps = parser.parse_docx(content)
    assert [step["sequence_no"] for step in steps] == [6, 7, 7]
    assert steps[1]["source_row"] == "1:4"
    assert steps[2]["source_row"] == "1:5"
    assert data["original_steps"] == steps
    assert any("序号7重复" in issue for issue in data["issues"])


def test_word_form_matches_real_dispatch_labels_without_guessing_stock_or_units():
    result = parser.parse_docx(
        docx(
            [
                ["热沉事业部生产工艺流转单"],
                ["编号：QEHAT-NR/D-8.5.1-51", "版本：A/2"],
                ["第1次派工 T4-03-72-MT 客户代码：11600-T3 （库房来料、产品订单/其他）"],
                ["流水号", "尺寸规格", "材 质", "数 量/单位", "客户要求：", "优先级"],
                [
                    "691236-50",
                    "详见图纸:NP000500010-A4",
                    "Mo70Cu30",
                    "18100",
                    "外观级别:加工态A级;按图纸要求加工",
                    "3-正常",
                ],
                [
                    "来料数量：",
                    "41",
                    "来料重量：",
                    "171.60",
                    "下单日期：",
                    "2026-8-2",
                    "交货日期：",
                    "2026-11-5",
                    "坯料批号",
                    "",
                ],
                HEADERS,
                [0, "中转库", "691236-49,691236-50,691236-51共投", "0", "226.00"],
                [1, "线切割", "按图加工", "7", "4008.00"],
            ]
        )
    )
    assert values(result) == {
        "serial_no": "691236-50",
        "material_name": "Mo70Cu30",
        "customer_code": "11600-T3",
        "quantity": 41,
        "delivery_date": "2026-11-05",
        "technical_requirements": "外观级别:加工态A级;按图纸要求加工",
    }
    assert result[0]["receipt_fields"]["quantity"] == {
        "value": 41,
        "label": "本次来料件数",
        "source_row": "1:6",
        "source_label": "来料数量：",
    }
    assert result[1] == ["691236-50"]
    assert result[2][0]["instructions"] == "691236-49,691236-50,691236-51共投"
    assert any("未标明重量单位" in text for text in result[0]["field_warnings"])
    assert len(result[0]["original_steps"]) == 2
    assert result[0]["tables"][0][4][3] == "18100"
    # The document/form identifier and an unlabelled product code are distinct.
    assert "product_code" not in values(result) and "part_no" not in values(result)


@pytest.mark.parametrize(
    ("label", "raw", "expected"),
    [
        ("来料重量（kg）", "171.60", 171.6),
        ("来料重量(g)", "171600", 171.6),
        ("来料重量", "171600克", 171.6),
        ("来料重量", "12.345678 kg", 12.345678),
    ],
)
def test_explicit_weight_units_are_normalized_to_kg(label, raw, expected):
    result = parser.parse_docx(docx([[label, raw], *PROCESS]))
    assert values(result)["weight"] == expected


def test_inline_fields_and_customer_requirements_keep_their_own_text():
    result = parser.parse_docx(
        docx(
            [
                ["流水号：ORDER-9；材质：W80；客户代码：ACME"],
                ["来料重量(kg)：2.5"],
                ["成品规格", "10×20×2 mm", "来料尺寸", "100×80×5 mm"],
                ["产品编号", "P-8", "件号", "N-7", "原单批号", "B-6"],
                ["技术要求：无磕碰；按图纸加工。", "特殊工艺", "热处理"],
                ["应发成品件数", "100件"],
                *PROCESS,
            ]
        )
    )
    assert values(result) == {
        "serial_no": "ORDER-9",
        "material_name": "W80",
        "customer_code": "ACME",
        "weight": 2.5,
        "finished_specification": "10×20×2 mm",
        "transfer_specification": "100×80×5 mm",
        "product_code": "P-8",
        "part_no": "N-7",
        "source_batch_no": "B-6",
        "technical_requirements": "无磕碰；按图纸加工。",
        "special_process": "热处理",
        "delivery_quantity": 100,
    }


def test_conflicting_fields_and_invalid_values_are_not_silently_chosen():
    result = parser.parse_docx(
        docx(
            [
                ["材质", "W80"],
                ["材质", "W90"],
                ["来料数量", "4.5"],
                ["来料重量(kg)", "500g"],
                ["交货日期", "2026-02-30"],
                ["订单数量", "18100"],
                ["数量/单位", "999"],
                *PROCESS,
            ]
        )
    )
    assert values(result) == {}
    warnings = result[0]["field_warnings"]
    for expected in (
        "多个不同值",
        "整数",
        "单位与表头不一致",
        "日期无效",
        "订单数量",
        "数量/单位",
    ):
        assert any(expected in warning for warning in warnings)


def test_process_values_do_not_become_receipt_values_and_originals_are_independent():
    result = parser.parse_docx(
        docx(
            [
                ["流水号", "尺寸规格"],
                ["ORDER-9", "按图纸"],
                HEADERS,
                [0, "中转库", "来料重量：900kg；来料数量：999", "1", "500"],
            ]
        )
    )
    assert values(result) == {"serial_no": "ORDER-9"}
    result[2][0]["instructions"] = "edited"
    assert "900kg" in result[0]["original_steps"][0]["instructions"]


@pytest.mark.parametrize(
    "content",
    [
        b"not a zip",
        docx([["无关文档", "这是会议纪要"]]),
        docx([], xml="<document><body/></document>"),
        docx([], xml="<broken>"),
    ],
)
def test_unrelated_or_forged_documents_are_rejected(content):
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(content)
    assert exc.value.status_code == 422


@pytest.mark.parametrize(
    ("name", "content"),
    [
        ("word/vbaProject.bin", b"macro"),
        ("word/activeX/activeX1.xml", b"<control/>"),
        ("word/embeddings/oleObject1.bin", b"object"),
        (
            "[Content_Types].xml",
            b'<Types ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>',
        ),
        (
            "word/_rels/document.xml.rels",
            b'<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject"/>',
        ),
        ("customXml/item1.xml", b'<!DOCTYPE root [<!ENTITY x "attack">]><root>&x;</root>'),
        ("../escape.xml", b"<file/>"),
        ("word/payload.exe", b"executable"),
    ],
)
def test_macros_embedded_objects_entities_and_unsafe_paths_are_rejected(name, content):
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(docx(PROCESS, parts={name: content}))
    assert exc.value.status_code == 422


def test_utf16_entity_and_embedded_control_in_document_are_rejected():
    for xml in (
        '<?xml version="1.0" encoding="utf-16"?><!DOCTYPE root [<!ENTITY x "attack">]><root>&x;</root>'.encode(
            "utf-16"
        ),
        '<w:document xmlns:w="' + parser.NS["w"] + '"><w:body><w:object/></w:body></w:document>',
    ):
        with pytest.raises(HTTPException) as exc:
            parser.parse_docx(docx([], xml=xml))
        assert exc.value.status_code == 422


def test_file_size_expansion_and_entry_limits_are_enforced(monkeypatch):
    content = docx(PROCESS, parts={"customXml/large.xml": "<xml>" + "x" * 20000 + "</xml>"})
    monkeypatch.setattr(parser, "MAX_EXPANDED_BYTES", 10000)
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(content)
    assert exc.value.status_code == 422
    monkeypatch.setattr(parser, "MAX_EXPANDED_BYTES", 20 * 1024 * 1024)
    monkeypatch.setattr(parser, "MAX_ARCHIVE_ENTRIES", 1)
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(content)
    assert exc.value.status_code == 422
    monkeypatch.setattr(parser, "MAX_FILE_BYTES", len(content) - 1)
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(content)
    assert exc.value.status_code == 413


def test_duplicate_archive_names_and_unsupported_compression_are_rejected():
    content = docx(PROCESS)
    stream = BytesIO(content)
    with ZipFile(stream, "a") as archive, pytest.warns(UserWarning, match="Duplicate name"):
        archive.writestr("word/document.xml", "<fake/>")
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(stream.getvalue())
    assert exc.value.status_code == 422
    # Unsupported compression must be a validation error, not a server error.
    unsupported = bytearray(content)
    unsupported[8:10] = (99).to_bytes(2, "little")
    central = unsupported.index(b"PK\x01\x02")
    unsupported[central + 10 : central + 12] = (99).to_bytes(2, "little")
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(bytes(unsupported))
    assert exc.value.status_code == 422


def test_encrypted_archive_flag_is_rejected():
    content = bytearray(docx(PROCESS))
    content[6:8] = (1).to_bytes(2, "little")
    central = content.index(b"PK\x01\x02")
    content[central + 8 : central + 10] = (1).to_bytes(2, "little")
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(bytes(content))
    assert exc.value.status_code == 422


def test_single_column_label_value_pairs_are_supported():
    result = parser.parse_docx(docx([["流水号"], ["ONE-1"], ["材质"], ["W80"], *PROCESS]))
    assert values(result) == {"serial_no": "ONE-1", "material_name": "W80"}


@pytest.mark.parametrize("part", ["word/document.xml", "word/header1.xml", "customXml/item1.xml"])
def test_html_alt_chunks_are_rejected_in_every_xml_part(part):
    chunk = '<x:altChunk xmlns:x="' + parser.NS["w"] + '"/>'
    if part == "word/document.xml":
        with ZipFile(BytesIO(docx(PROCESS))) as archive:
            xml = archive.read(part).decode().replace("</w:body>", chunk + "</w:body>")
        content = docx([], xml=xml)
    else:
        content = docx(PROCESS, parts={part: chunk})
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(content)
    assert exc.value.status_code == 422


def root_relationship(target, mode="Internal"):
    return (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
        ' Target="' + escape(target) + '" TargetMode="' + mode + '"/></Relationships>'
    )


@pytest.mark.parametrize("target", ["word/document.xml", "/word/document.xml"])
def test_main_document_relationship_matches_parser_and_normal_hyperlinks_are_allowed(target):
    content = docx(
        PROCESS,
        parts={
            "_rels/.rels": root_relationship(target),
            "word/_rels/document.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"'
            ' Target="https://example.com/drawing" TargetMode="External"/></Relationships>',
        },
    )
    assert len(parser.parse_docx(content)[2]) == 2


@pytest.mark.parametrize(
    ("target", "mode"),
    [
        ("customXml/other.xml", "Internal"),
        ("https://example.com/document.xml", "External"),
        ("word/document.xml", "External"),
        ("word/../word/document.xml", "Internal"),
        ("word/document.xml#other", "Internal"),
    ],
)
def test_alternate_or_external_main_documents_are_rejected(target, mode):
    content = docx(PROCESS, parts={"_rels/.rels": root_relationship(target, mode)})
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(content)
    assert exc.value.status_code == 422


def test_ambiguous_multiple_main_document_relationships_are_rejected():
    relationships = root_relationship("word/document.xml").replace(
        "</Relationships>",
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
        ' Target="word/document.xml"/></Relationships>',
    )
    with pytest.raises(HTTPException) as exc:
        parser.parse_docx(docx(PROCESS, parts={"_rels/.rels": relationships}))
    assert exc.value.status_code == 422


def test_instruction_references_never_identify_the_route_without_a_header_serial():
    result = parser.parse_docx(docx([HEADERS, [0, "中转库", "OTHER-1,OTHER-2共投", "0", "20"]]))
    assert result[1] == []
    assert result[2][0]["instructions"] == "OTHER-1,OTHER-2共投"
    assert any("未明确识别流水号" in issue for issue in result[0]["issues"])


def test_conflicting_explicit_serial_fields_require_review_instead_of_guessing():
    result = parser.parse_docx(docx([["流水号", "ONE"], ["流水号", "TWO"], *PROCESS]))
    assert result[1] == []
    assert "serial_no" not in result[0]["receipt_fields"]
