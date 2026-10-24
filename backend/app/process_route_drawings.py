"""Validate drawings and adjust display direction without recording business contents."""

from collections import Counter
from io import BytesIO
from math import atan2, degrees

from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject

from .process_route_import import MAX_FILE_BYTES

MAX_DRAWINGS = 10
FORBIDDEN_KEYS = {"/JS", "/JavaScript", "/AA", "/EmbeddedFiles", "/EF", "/RichMedia", "/XFA"}
FORBIDDEN_ACTIONS = {"/JavaScript", "/Launch", "/SubmitForm", "/ImportData", "/GoToR", "/URI"}


def validate_drawing(filename, content):
    if not filename.lower().endswith(".pdf") or len(filename) > 240:
        raise HTTPException(422, "图纸仅支持PDF格式，文件名不能超过240字")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "每份图纸不能超过5MB")
    if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-1024:]:
        raise HTTPException(422, "图纸不是有效的PDF文件")
    try:
        reader = PdfReader(BytesIO(content), strict=True)
        if reader.is_encrypted:
            raise ValueError("不支持加密PDF")
        if not 1 <= len(reader.pages) <= 100:
            raise ValueError("PDF须包含1至100页")
        pending, seen = [reader.trailer["/Root"]], set()
        count = 0
        while pending:
            value = pending.pop()
            if isinstance(value, IndirectObject):
                key = (value.idnum, value.generation)
                if key in seen:
                    continue
                seen.add(key)
                value = value.get_object()
            count += 1
            if count > 50000:
                raise ValueError("PDF结构过于复杂")
            if isinstance(value, DictionaryObject):
                if FORBIDDEN_KEYS.intersection(value) or value.get("/S") in FORBIDDEN_ACTIONS:
                    raise ValueError("PDF包含脚本、外部链接或嵌入文件")
                pending.extend(value.values())
            elif isinstance(value, ArrayObject):
                pending.extend(value)
    except Exception as error:
        raise HTTPException(422, "图纸PDF无效，或包含加密、脚本、外部链接或嵌入文件") from error


def drawing_preview(content):
    """Correct a clearly sideways text layout for display; never rewrite the original."""
    try:
        # Upload validation is strict; tolerate harmless CAD whitespace for display.
        reader = PdfReader(BytesIO(content), strict=False)
        changed = False
        remaining = 8 * 1024 * 1024
        for page in reader.pages:
            stream = page.get_contents()
            if stream is None:
                continue
            remaining -= len(stream.get_data())
            if remaining < 0:
                break
            directions = Counter()

            def direction(text, cm, tm, _font, _size, counts=directions):
                # Count glyph directions only. Do not retain or interpret drawing text.
                if not text.strip():
                    return
                angle = (
                    degrees(atan2(tm[0] * cm[1] + tm[1] * cm[3], tm[0] * cm[0] + tm[1] * cm[2]))
                    % 360
                )
                quarter = round(angle / 90) * 90 % 360
                if min(abs(angle - quarter), 360 - abs(angle - quarter)) <= 2:
                    counts[quarter] += len(text.strip())

            page.extract_text(visitor_text=direction)
            if not directions:
                continue
            rotation, count = directions.most_common(1)[0]
            if (
                count >= 20
                and count >= sum(directions.values()) * 0.85
                and rotation != page.rotation % 360
            ):
                page.rotate((rotation - page.rotation) % 360)
                changed = True
        if not changed:
            return content
        writer = PdfWriter()
        writer.append_pages_from_reader(reader)
        output = BytesIO()
        writer.write(output)
        return output.getvalue()
    except Exception:
        # Image-only or unusual layouts remain readable in the native PDF viewer.
        return content
