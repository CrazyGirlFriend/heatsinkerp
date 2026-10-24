"""Bounded OOXML table reader. Source rows remain available for human review."""

import re
from copy import deepcopy
from datetime import date
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, LargeZipFile, ZipFile
from zlib import error as ZlibError

from fastapi import HTTPException

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_EXPANDED_BYTES = 20 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 500
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
HEADERS = ("序号", "工序名称", "工艺要求", "计划完成天数", "计划加工数量")


def cell_text(cell):
    return "\n".join(
        "".join(node.text or "" for node in paragraph.findall(".//w:t", NS))
        for paragraph in cell.findall("w:p", NS)
    ).strip()


def read_document(content):
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "Word文件不能超过5MB")
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if (
                len(entries) > MAX_ARCHIVE_ENTRIES
                or sum(item.file_size for item in entries) > MAX_EXPANDED_BYTES
            ):
                raise ValueError("文件解压后过大")
            if not {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}.issubset(
                {item.filename for item in entries}
            ):
                raise ValueError("缺少Word文档包的必要部件")
            names = set()
            document = None
            content_types = None
            for item in entries:
                name = item.filename.replace("\\", "/").lower()
                if (
                    name in names
                    or name.startswith("/")
                    or ".." in PurePosixPath(name).parts
                    or item.flag_bits & 1
                ):
                    raise ValueError("文件包含重复、加密或非法路径")
                names.add(name)
                if (
                    "vbaproject" in name
                    or "vbadata" in name
                    or "/activex/" in name
                    or "/embeddings/" in name
                    or PurePosixPath(name).suffix
                    in (".exe", ".dll", ".com", ".bat", ".cmd", ".ps1", ".vbs")
                ):
                    raise ValueError("不支持宏、ActiveX或嵌入对象")
                if not name.endswith((".xml", ".rels")):
                    continue
                xml = archive.read(item)
                safe_xml = xml.replace(b"\x00", b"").lower()
                if any(
                    token in safe_xml
                    for token in (
                        b"<!doctype",
                        b"<!entity",
                        b"macroenabled",
                        b"vnd.ms-office.vbaproject",
                        b"vnd.ms-office.activex",
                        b"/relationships/oleobject",
                        b"/relationships/package",
                        b"/relationships/control",
                        b"/relationships/attachedtemplate",
                    )
                ):
                    raise ValueError("文件包含不支持的实体、宏或嵌入对象")
                # HTML chunks can live in headers or alternate parts as well
                # as the main body. They are outside this fixed Word form.
                part = ET.fromstring(xml)
                if any(node.tag.rsplit("}", 1)[-1] == "altChunk" for node in part.iter()):
                    raise ValueError("不支持嵌入HTML内容")
                if name == "_rels/.rels":
                    package_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
                    if part.tag != "{" + package_ns + "}Relationships":
                        raise ValueError("Word文档包关系格式无效")
                    documents = [
                        relation
                        for relation in part
                        if relation.tag == "{" + package_ns + "}Relationship"
                        and relation.attrib.get("Type")
                        == "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
                    ]
                    if len(documents) != 1 or any(
                        relation.attrib.get("TargetMode", "").strip().casefold()
                        not in ("", "internal")
                        or relation.attrib.get("Target", "").removeprefix("/")
                        != "word/document.xml"
                        for relation in documents
                    ):
                        raise ValueError("工艺表正文关系不符合固定Word模板")
                if name == "[content_types].xml":
                    content_types = part
                if name == "word/document.xml":
                    document = xml
            if document is None:
                raise ValueError("缺少Word正文")
            types_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
            if content_types is None or content_types.tag != "{" + types_ns + "}Types":
                raise ValueError("Word文档包类型格式无效")
            main_types = [
                item.attrib.get("ContentType")
                for item in content_types
                if item.tag == "{" + types_ns + "}Override"
                and item.attrib.get("PartName") == "/word/document.xml"
            ]
            if main_types != [
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
            ]:
                raise ValueError("只支持普通Word文档正文类型")
            root = ET.fromstring(document)
            if root.tag != "{" + NS["w"] + "}document" or root.find("w:body", NS) is None:
                raise ValueError("不是Word正文")
            if (
                root.find(".//w:object", NS) is not None
                or root.find(".//w:control", NS) is not None
            ):
                raise ValueError("不支持嵌入对象或控件")
            return root
    except (
        BadZipFile,
        LargeZipFile,
        KeyError,
        ET.ParseError,
        ValueError,
        RuntimeError,
        OSError,
        EOFError,
        ZlibError,
    ) as exc:
        raise HTTPException(
            422, "无法导入：仅支持未加密、不含宏和嵌入对象的工艺流转单.docx文件"
        ) from exc


# These labels describe receipt fields explicitly. Ambiguous order/process
# quantities remain in the original table and never become physical stock.
FIELD_LABELS = {
    "serial_no": ("流水号", "生产流水号"),
    "material_name": ("材质", "材料牌号"),
    "product_code": ("产品编号", "产品编码"),
    "part_no": ("件号", "零件号"),
    "customer_code": ("客户代码", "客户编码"),
    "finished_specification": ("成品规格", "产品规格"),
    "transfer_specification": ("转料规格", "来料规格", "来料尺寸"),
    "source_batch_no": ("原单批号", "坯料批号", "来料批号"),
    "quantity": ("来料数量", "来料件数", "实际来料数量", "入库件数"),
    "weight": ("来料重量", "实际来料重量", "入库重量"),
    "delivery_date": ("交货日期", "要求发货日期"),
    "delivery_quantity": ("应发成品件数", "应发件数"),
    "technical_requirements": ("客户要求", "技术要求"),
    "special_process": ("特殊工艺",),
}
FIELD_TITLES = {
    "serial_no": "流水号",
    "material_name": "材质",
    "product_code": "编号",
    "part_no": "件号",
    "customer_code": "客户代码",
    "finished_specification": "成品规格",
    "transfer_specification": "转料规格",
    "source_batch_no": "原单批号",
    "quantity": "本次来料件数",
    "weight": "本次来料重量（kg）",
    "delivery_date": "要求发货日期",
    "delivery_quantity": "应发成品件数",
    "technical_requirements": "技术要求",
    "special_process": "特殊工艺",
}
FIELD_MAX_LENGTH = {
    "serial_no": 80,
    "material_name": 160,
    "product_code": 80,
    "part_no": 80,
    "customer_code": 80,
    "finished_specification": 240,
    "transfer_specification": 240,
    "source_batch_no": 80,
    "technical_requirements": 4000,
    "special_process": 2000,
}
AMBIGUOUS_LABELS = {"数量", "数量/单位", "订单数量", "计划加工数量", "尺寸规格", "图纸号"}


def normalize_label(value):
    return re.sub(r"\s+", "", value).rstrip("：:").replace("（", "(").replace("）", ")")


def field_label(value):
    normalized = normalize_label(value)
    # Units may be declared in the label or alongside its value.
    base = re.sub(r"\((?:kg|g|千克|公斤|克|件|块)\)$", "", normalized, flags=re.I)
    for key, labels in FIELD_LABELS.items():
        if base in labels:
            return key
    return None


def numeric_value(key, value, source_label):
    if len(value) > 100:
        raise ValueError("数值内容过长")
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)\s*(kg|g|千克|公斤|克|件|块)?", value, re.I)
    if not match:
        raise ValueError("数值或单位无法明确识别")
    amount = Decimal(match[1])
    unit = (match[2] or "").lower()
    if key != "weight":
        if unit not in ("", "件", "块") or amount != amount.to_integral_value():
            raise ValueError("件数必须是明确的整数")
        if not 0 < amount <= 2_147_483_647:
            raise ValueError("件数超出可录入范围")
        return int(amount)
    label_unit = re.search(r"\((kg|g|千克|公斤|克)\)$", normalize_label(source_label), re.I)
    label_unit = label_unit[1].lower() if label_unit else ""
    units = {"kg": 1, "千克": 1, "公斤": 1, "g": 1000, "克": 1000}
    if unit and label_unit and units.get(unit) != units.get(label_unit):
        raise ValueError("重量单位与表头不一致")
    unit = unit or label_unit
    if unit not in units:
        raise ValueError("未标明重量单位，不能直接按kg录入")
    amount /= units[unit]
    if not 0 < amount < Decimal("100000000000") or amount.as_tuple().exponent < -6:
        raise ValueError("重量超出可录入范围或精度")
    return float(amount)


def receipt_value(key, value, source_label):
    if key in ("quantity", "weight", "delivery_quantity"):
        return numeric_value(key, value, source_label)
    if key == "delivery_date":
        match = re.fullmatch(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?", value)
        if not match:
            raise ValueError("日期格式无法明确识别")
        try:
            result = date(*(int(part) for part in match.groups()))
        except ValueError as exc:
            raise ValueError("日期无效") from exc
        if not 2000 <= result.year <= 2100:
            raise ValueError("日期超出可录入范围")
        return result.isoformat()
    if len(value) > FIELD_MAX_LENGTH[key]:
        raise ValueError("内容过长，请人工核对")
    return value


def extract_receipt_fields(tables):
    fields, warnings, serials, conflicting = {}, [], [], set()

    def warning(row_id, message):
        text = f"表{row_id.split(':')[0]}第{row_id.split(':')[1]}行：{message}"
        if text not in warnings:
            warnings.append(text)

    def add(key, raw, source_label, row_id):
        raw = raw.strip()
        if not raw or raw in ("—", "-", "/"):
            return
        try:
            value = receipt_value(key, raw, source_label)
        except (ValueError, InvalidOperation) as exc:
            warning(row_id, f"{source_label.rstrip('：:')}：{exc}，未自动填入")
            return
        if key == "serial_no" and value not in serials:
            serials.append(value)
        if key in conflicting:
            return
        if key in fields and fields[key]["value"] != value:
            fields.pop(key)
            conflicting.add(key)
            warning(row_id, f"{FIELD_TITLES[key]}有多个不同值，未自动填入")
            return
        fields.setdefault(
            key,
            {
                "value": value,
                "label": FIELD_TITLES[key],
                "source_row": row_id,
                "source_label": source_label,
            },
        )

    for table_index, rows in enumerate(tables, 1):
        for row_index, row in enumerate(rows):
            normalized = [normalize_label(value) for value in row]
            if all(value in normalized for value in HEADERS):
                break  # Process quantities/instructions do not describe the stock origin.
            row_id = f"{table_index}:{row_index + 1}"
            recognized = sum(
                bool(field_label(value)) or normalize_label(value) in AMBIGUOUS_LABELS
                for value in row
            )
            vertical = (
                (recognized >= 2 or (len(row) == 1 and recognized == 1))
                and row_index + 1 < len(rows)
                and len(rows[row_index + 1]) == len(row)
                and not any(field_label(value) for value in rows[row_index + 1])
            )
            for index, cell in enumerate(row):
                key = field_label(cell)
                if key:
                    candidate = (
                        rows[row_index + 1][index]
                        if vertical
                        else (row[index + 1] if index + 1 < len(row) else "")
                    )
                    if (
                        not field_label(candidate)
                        and normalize_label(candidate) not in AMBIGUOUS_LABELS
                    ):
                        add(
                            key,
                            candidate,
                            cell.strip(),
                            f"{table_index}:{row_index + 2}" if vertical else row_id,
                        )
                elif normalize_label(cell) in AMBIGUOUS_LABELS:
                    warning(row_id, f"“{cell.strip()}”与入库字段口径不明确，仅保留原文，不自动填入")
                # Each inline value stops at the next explicit label, so one
                # cell cannot turn a customer code into part of its material.
                labels = sorted(
                    (label for labels in FIELD_LABELS.values() for label in labels),
                    key=len,
                    reverse=True,
                )
                inline_values = list(
                    re.finditer(
                        "("
                        + "|".join(re.escape(label) for label in labels)
                        + r")(?:\s*[（(](?:kg|g|千克|公斤|克|件|块)[）)])?\s*[：:]\s*",
                        cell,
                        re.I,
                    )
                )
                for position, inline in enumerate(inline_values):
                    end = (
                        inline_values[position + 1].start()
                        if position + 1 < len(inline_values)
                        else len(cell)
                    )
                    value = cell[inline.end() : end].strip().rstrip("；;")
                    if field_label(inline[1]) == "customer_code":
                        value = re.split(r"\s+[（(]", value, maxsplit=1)[0].strip()
                    add(field_label(inline[1]), value, inline[0].rstrip("：: "), row_id)
    return fields, warnings, serials


def parse_docx(content):
    root = read_document(content)
    tables = []
    for table in root.findall(".//w:tbl", NS):
        tables.append(
            [
                [cell_text(cell) for cell in row.findall("w:tc", NS)]
                for row in table.findall("w:tr", NS)
            ]
        )
    steps, issues = [], []
    for table_index, rows in enumerate(tables):
        header = None
        for row_index, row in enumerate(rows):
            normalized = [re.sub(r"\s+", "", value) for value in row]
            if all(value in normalized for value in HEADERS):
                header = {name: normalized.index(name) for name in HEADERS}
                continue
            if header is None or not row:
                continue
            if max(header.values()) >= len(row):
                if len(row) == 1 and len(row[0]) > 40:
                    continue  # Document-wide footnotes remain in the original table.
                issues.append(f"表{table_index + 1}第{row_index + 1}行列数不完整，请人工核对")
                continue
            values = {name: row[index].strip() for name, index in header.items()}
            name, instruction = values["工序名称"], values["工艺要求"]
            if not any(values.values()):
                continue
            sequence = values["序号"]
            if not sequence.isdigit():
                issues.append(f"表{table_index + 1}第{row_index + 1}行序号无法识别，已保留待核对")
            if not name:
                issues.append(f"表{table_index + 1}第{row_index + 1}行缺少工序名称")
            steps.append(
                {
                    "sequence_no": int(sequence) if sequence.isdigit() else -1,
                    "name": name,
                    "instructions": instruction,
                    "planned_days": values["计划完成天数"],
                    "planned_quantity": values["计划加工数量"],
                    "team_id": None,
                    "processing_task_id": None,
                    "purpose_id": None,
                    "serial_nos": [],
                    "split_here": False,
                    "source_row": f"{table_index + 1}:{row_index + 1}",
                }
            )
    if not steps:
        raise HTTPException(
            422, "未找到包含序号、工序名称、工艺要求、计划完成天数、计划加工数量的工序表"
        )
    if len(steps) > 100:
        raise HTTPException(422, "单份工艺路线最多100道工序")
    sequences = [step["sequence_no"] for step in steps]
    for sequence in sorted(set(sequences)):
        if sequences.count(sequence) > 1:
            issues.append(f"工序序号{sequence}重复，发布前须人工核对")
    fields, field_warnings, _ = extract_receipt_fields(tables)
    # Instructions may mention other orders. Only the explicit form field identifies this route.
    serial_nos = [str(fields["serial_no"]["value"])] if "serial_no" in fields else []
    if not serial_nos:
        issues.append("未明确识别流水号，请对照原文补充本次派工名单")
    return (
        {
            "tables": tables,
            "issues": issues,
            "original_steps": deepcopy(steps),
            "receipt_fields": fields,
            "field_warnings": field_warnings,
        },
        serial_nos,
        steps,
    )
