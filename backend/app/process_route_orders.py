"""Read the single-order Excel export and merge it beneath the Word work order."""

import hashlib
import json
import re
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException

from .process_route_import import MAX_FILE_BYTES, receipt_value

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
# Only explicit equivalents become stock-document fields. Other columns remain in the source.
COLUMNS = {
    "流水号": ("serial_no", "流水号"),
    "客户代码": ("customer_code", "客户代码"),
    "编号": ("product_code", "编号"),
    "材质细分": ("material_name", "材质"),
    "成品规格": ("finished_specification", "成品规格"),
    "技术要求": ("technical_requirements", "技术要求"),
    "用途分类": ("purpose_category", "用途分类"),
    "订单分类": ("order_category", "订单分类"),
    "品名": ("material_description", "物料说明"),
    "交货期": ("delivery_date", "要求发货日期"),
    "数量": ("delivery_quantity", "应发成品件数"),
}
EXTRA_LIMITS = {"purpose_category": 80, "order_category": 80, "material_description": 2000}


def material_value(key, value):
    text = str(value).strip()
    if key in EXTRA_LIMITS:
        if len(text) > EXTRA_LIMITS[key]:
            raise ValueError("内容过长")
        return text
    return receipt_value(key, text, "重量(kg)" if key == "weight" else "")


def parse_order(content, filename):
    if not filename.lower().endswith(".xlsx") or len(filename) > 240:
        raise HTTPException(422, "订单资料仅支持 .xlsx 文件")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "订单表不能超过 5 MB")
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 500 or sum(item.file_size for item in entries) > 20 * 1024 * 1024:
                raise ValueError("订单表解压后过大")
            parts, names = {}, set()
            for item in entries:
                name = item.filename.replace("\\", "/").lower()
                if (
                    name in names
                    or name.startswith("/")
                    or ".." in PurePosixPath(name).parts
                    or item.flag_bits & 1
                ):
                    raise ValueError("订单表包含无效或加密部件")
                names.add(name)
                if any(
                    token in name
                    for token in ("vbaproject", "vbadata", "activex", "embeddings", "externallinks")
                ):
                    raise ValueError("订单表不支持宏、外链或嵌入对象")
                if name.endswith((".xml", ".rels")):
                    raw = archive.read(item)
                    lowered = raw.replace(b"\x00", b"").lower()
                    if any(
                        token in lowered for token in (b"<!doctype", b"<!entity", b"macroenabled")
                    ):
                        raise ValueError("订单表包含不支持的内容")
                    root = ET.fromstring(raw)
                    if any(node.attrib.get("TargetMode") == "External" for node in root.iter()):
                        raise ValueError("订单表不支持外部链接")
                    parts[name] = root
            workbook = parts["xl/workbook.xml"]
            sheets = workbook.findall("s:sheets/s:sheet", NS)
            if len(sheets) != 1:
                raise ValueError("请上传仅含一个工作表的订单表")
            relations = parts["xl/_rels/workbook.xml.rels"]
            rid = sheets[0].get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            relation = next(node for node in relations if node.get("Id") == rid)
            if not relation.get("Type", "").endswith("/worksheet"):
                raise ValueError("订单工作表无效")
            target = relation.attrib["Target"].lstrip("/")
            sheet = parts[target.lower() if target.startswith("xl/") else "xl/" + target.lower()]
            strings = [
                "".join(node.itertext())
                for node in parts.get("xl/sharedstrings.xml", ET.Element("empty"))
            ]
            cells = {}
            for cell in sheet.findall("s:sheetData/s:row/s:c", NS):
                coord = cell.attrib["r"]
                match = re.fullmatch(r"([A-Z]{1,3})([1-9][0-9]*)", coord)
                if not match:
                    raise ValueError("单元格位置无效")
                column = 0
                for char in match[1]:
                    column = column * 26 + ord(char) - 64
                if column > 100 or int(match[2]) > 200:
                    raise ValueError("订单表范围过大（最多 100 列、200 行）")
                if cell.find("s:f", NS) is not None:
                    raise ValueError("订单表含公式，请导出为纯数据后上传")
                value = cell.findtext("s:v", default="", namespaces=NS)
                kind = cell.get("t")
                if kind == "s":
                    value = strings[int(value)]
                elif kind == "inlineStr":
                    value = "".join(node.text or "" for node in cell.findall("s:is//s:t", NS))
                elif kind == "e":
                    raise ValueError(f"单元格 {coord} 有错误值")
                if len(value) > 10000:
                    raise ValueError("订单表单元格内容过长")
                if value.strip():
                    cells[(int(match[2]), column)] = value.strip()
            rows = sorted({row for row, _ in cells})
            if len(rows) != 2:
                raise ValueError("请上传一行表头、一条流水号数据的订单表")
            width = max(column for _, column in cells)
            headers = [cells.get((rows[0], col), "") for col in range(1, width + 1)]
            values = [cells.get((rows[1], col), "") for col in range(1, width + 1)]
            if headers.count("流水号") != 1 or not {
                "客户代码",
                "数量",
                "数量单位",
                "交货期",
            } <= set(headers):
                raise ValueError("订单表须包含流水号、客户代码、数量、数量单位、交货期")
            serial = values[headers.index("流水号")]
            if not serial or len(serial) > 80:
                raise ValueError("订单流水号无效")
            epoch = (
                date(1904, 1, 1)
                if workbook.find("s:workbookPr", NS) is not None
                and workbook.find("s:workbookPr", NS).get("date1904") in ("1", "true")
                else date(1899, 12, 30)
            )
            fields, warnings = {}, []
            display_values = values.copy()
            for index, (label, raw) in enumerate(zip(headers, values, strict=True)):
                if label in {"日期", "交货期", "计划初转", "计划终转"} and re.fullmatch(
                    r"[0-9]+(?:\.0+)?", raw
                ):
                    try:
                        display_values[index] = (
                            epoch + timedelta(days=int(Decimal(raw)))
                        ).isoformat()
                    except (OverflowError, ValueError) as exc:
                        raise ValueError(f"{label}：日期无效") from exc
                if not raw or label not in COLUMNS:
                    continue
                key, title = COLUMNS[label]
                try:
                    value = raw
                    if key == "delivery_date" and re.fullmatch(r"[0-9]+(?:\.0+)?", raw):
                        value = (epoch + timedelta(days=int(Decimal(raw)))).isoformat()
                    if key == "delivery_quantity" and values[headers.index("数量单位")] != "件":
                        raise ValueError("数量单位不是件")
                    value = material_value(key, value)
                    if key in fields and fields[key]["value"] != value:
                        raise ValueError("重复列内容不一致")
                    fields[key] = {
                        "value": value,
                        "label": title,
                        "source_label": label,
                        "source_row": f"{sheets[0].get('name')} · 第{rows[1]}行第{index + 1}列",
                        "source_kind": "excel",
                        "source_filename": filename,
                    }
                except (ValueError, InvalidOperation, OverflowError) as exc:
                    raise ValueError(f"{label}：{exc}") from exc
            return {
                "filename": filename,
                "sheet": sheets[0].get("name"),
                "headers": headers,
                "values": values,
                "display_values": display_values,
                "serial_no": serial,
                "receipt_fields": fields,
                "warnings": warnings,
            }
    except (ValueError, KeyError, IndexError, StopIteration, BadZipFile, ET.ParseError) as exc:
        raise HTTPException(422, f"无法导入订单表：{exc}") from exc


def merge_materials(data, *, word=None, order=None, filename=None):
    result = deepcopy(data)
    if word is not None:
        result.update(word)
        result["word_fields"] = {
            key: {**field, "source_kind": "word", "source_filename": filename}
            for key, field in word.get("receipt_fields", {}).items()
        }
    if "word_fields" not in result:
        result["word_fields"] = deepcopy(result.get("receipt_fields", {}))
    if order is not None:
        result["order_document"] = order
    excel = result.get("order_document", {}).get("receipt_fields", {})
    word_fields = result["word_fields"]
    word_serial = word_fields.get("serial_no", {}).get("value")
    excel_serial = excel.get("serial_no", {}).get("value")
    if word_serial and excel_serial and word_serial != excel_serial:
        raise HTTPException(422, "订单表与工艺单流水号不一致")
    fields = deepcopy(excel)
    for key, field in word_fields.items():
        fields[key] = deepcopy(field)
        if key in excel and str(excel[key]["value"]) != str(field["value"]):
            fields[key]["alternative"] = excel[key]
    result["receipt_fields"] = fields
    result["review_required"] = True
    result.pop("material_confirmation", None)
    return result


def apply_material_values(row, values):
    if values is None:
        return
    data = deepcopy(row.source_data)
    fields = data.get("receipt_fields", {})
    for key, value in values.items():
        if key not in fields or key == "serial_no":
            raise HTTPException(422, "订单字段不存在或不可修改")
        try:
            parsed = material_value(key, value) if value is not None and str(value).strip() else ""
        except (ValueError, InvalidOperation) as exc:
            raise HTTPException(422, f"{fields[key]['label']}：{exc}") from exc
        field = fields[key]
        if str(parsed) != str(field["value"]):
            field.setdefault("parsed_value", field["value"])
            field["value"] = parsed
    row.source_data = data


def review_fingerprint(row):
    return hashlib.sha256(
        json.dumps(
            {
                "fields": row.source_data.get("receipt_fields", {}),
                "steps": row.steps,
                "serials": row.serial_nos,
                "word": row.source_sha256,
                "order": row.source_data.get("order_document"),
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode()
    ).hexdigest()
