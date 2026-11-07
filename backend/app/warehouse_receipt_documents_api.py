"""HTTP upload, download and access boundary for receipt originals."""

from pathlib import PurePath
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import Depends, File, Form, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from . import material_stock
from . import warehouse_receipt_documents as documents
from .async_api import AsyncAPIRouter
from .auth import get_current_user
from .database import get_db
from .models import User
from .process_route_import import MAX_FILE_BYTES
from .receipt_document_schemas import ReceiptDocumentResponse, ReceiptDocumentsResponse

router = AsyncAPIRouter(prefix="/api", dependencies=[Depends(get_current_user)])


@router.post(
    "/teams/{team_id}/receipt-documents",
    status_code=201,
    response_model=ReceiptDocumentResponse,
    response_model_exclude_unset=True,
)
async def upload_document(
    team_id: int,
    kind: Annotated[Literal["process", "drawing", "order"], Form()],
    file: Annotated[UploadFile, File()],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from .warehouse_receipts import require_warehouse

    try:
        require_warehouse(material_stock.require_actor(user, team_id))
        filename = PurePath((file.filename or "").replace("\\", "/")).name
        content = await file.read(MAX_FILE_BYTES + 1)
        parsed = await run_in_threadpool(documents.parsed_document, kind, filename, content)
        return await db.run_sync(
            lambda session: documents.save_upload(
                session, team_id, user, kind, filename, content, parsed
            )
        )
    finally:
        await file.close()


@router.get(
    "/receipt-documents/{document_id}",
    response_model=ReceiptDocumentResponse,
    response_model_exclude_unset=True,
)
def read_document(
    document_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return documents.document(documents.require_reader(db, document_id, user))


@router.get("/receipt-documents/{document_id}/file", response_class=Response)
async def download_document(
    document_id: int,
    preview: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    content, filename, media_type = await documents.download_payload(db, document_id, user, preview)
    return Response(
        content,
        media_type=media_type,
        headers={
            "Content-Disposition": ("inline" if preview else "attachment")
            + "; filename*=UTF-8''"
            + quote(filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/receipt-documents/{document_id}", status_code=204)
def delete_upload(
    document_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return documents.delete_upload(document_id, user, db)


@router.get(
    "/material-transfers/{batch_no}/receipt-documents",
    response_model=ReceiptDocumentsResponse,
    response_model_exclude_unset=True,
)
def receipt_documents(batch_no: str, db: Session = Depends(get_db)):
    return documents.receipt_documents(batch_no, db)
