"""Real attachment fixtures for normal routes used by workflow tests."""

from hashlib import sha256
from io import BytesIO

from app.database import SessionLocal
from app.models import ProcessRoute, ProcessRouteDrawing, ProcessRouteOrderFile
from app.process_route_orders import parse_order
from pypdf import PdfWriter
from sqlalchemy import select


def add_documents(route_id, *, word=True, order=True, drawing=True):
    from test_process_route_import import HEADERS, docx
    from test_process_route_orders import VALUES, xlsx

    with SessionLocal() as db:
        row = db.get(ProcessRoute, route_id)
        serial = row.serial_nos[0]
        if word and not row.source_file:
            row.source_file = docx([["流水号", serial], HEADERS, [0, "中转库", "备料", 0, 10]])
            row.filename = "工艺.docx"
            row.source_sha256 = sha256(row.source_file).hexdigest()
        if order and not db.get(ProcessRouteOrderFile, row.id):
            content = xlsx([serial, *VALUES[1:]])
            db.add(ProcessRouteOrderFile(route_id=row.id, filename="订单.xlsx", content=content))
            row.source_data = {
                **row.source_data,
                "order_document": parse_order(content, "订单.xlsx"),
            }
        if drawing and not db.scalar(
            select(ProcessRouteDrawing.id).where(ProcessRouteDrawing.route_id == row.id)
        ):
            writer, stream = PdfWriter(), BytesIO()
            writer.add_blank_page(100, 100)
            writer.write(stream)
            content = stream.getvalue()
            db.add(
                ProcessRouteDrawing(
                    route_id=row.id,
                    filename="图纸.pdf",
                    content=content,
                    size_bytes=len(content),
                    sha256=sha256(content).hexdigest(),
                )
            )
        db.commit()
