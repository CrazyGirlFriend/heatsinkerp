"""Each HTTP inventory request reads its own current database transaction."""

from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from starlette.responses import JSONResponse


def team_read_response(db, build, *, schema: type[BaseModel]):
    # JSONResponse bypasses FastAPI's response validation. Validate here for
    # typed read endpoints while retaining their no-store and numeric encoding.
    payload = schema.model_validate(build(db))
    return JSONResponse(
        jsonable_encoder(payload, exclude_unset=True), headers={"Cache-Control": "no-store"}
    )
