"""Serve an order original or its preview with consistent download headers."""

from pathlib import PurePath
from urllib.parse import quote

from fastapi import Response
from starlette.concurrency import run_in_threadpool

from .order_document_preview import order_document_preview


async def order_document_response(content, filename, *, preview=False):
    if preview:
        content = await run_in_threadpool(order_document_preview, content, filename)
        filename = str(PurePath(filename).with_suffix(".pdf"))
    return Response(
        content,
        media_type="application/pdf"
        if preview
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": ("inline" if preview else "attachment")
            + "; filename*=UTF-8''"
            + quote(filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
