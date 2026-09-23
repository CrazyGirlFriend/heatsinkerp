"""Each HTTP inventory request reads its own current database transaction."""

from fastapi.encoders import jsonable_encoder
from starlette.responses import JSONResponse


def team_read_response(db, build):
    return JSONResponse(jsonable_encoder(build(db)), headers={"Cache-Control": "no-store"})
