import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import Base
from app.models import ProcessRoute
from sqlalchemy import JSON, Column, Integer, MetaData, String, Table, create_engine, select, text
from sqlalchemy.exc import IntegrityError


def migration(filename="20261025_0053_process_route_serials.py"):
    path = Path(__file__).parents[1] / "alembic/versions" / filename
    spec = importlib.util.spec_from_file_location("process_serial_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("metadata_baseline", [False, True])
def test_backfill_reserves_normal_families_and_legacy_conflicts_without_rewriting_routes(
    metadata_baseline,
):
    engine = create_engine("sqlite://")
    routes = Table(
        "process_routes",
        MetaData(),
        Column("id", Integer, primary_key=True),
        Column("parent_id", Integer),
        Column("route_kind", String(16)),
        Column("serial_nos", JSON),
    )
    rows = [
        dict(id=index, parent_id=parent, route_kind=kind, serial_nos=serials)
        for index, parent, kind, serials in (
            (1, None, "normal", ["S-001"]),
            (2, 1, "normal", ["s-001"]),
            (3, None, "rework", ["S-001"]),
            (4, None, "normal", ["DUP"]),
            (5, None, "normal", [" dup "]),
            (6, None, "normal", ["MAIN", "NOTE"]),
            (7, 1, "normal", ["RENAMED"]),
        )
    ]
    try:
        with engine.begin() as connection:
            if metadata_baseline:
                Base.metadata.create_all(connection)
                connection.execute(
                    ProcessRoute.__table__.insert(),
                    [
                        dict(
                            **row,
                            title="x",
                            filename="",
                            source_file=b"",
                            source_sha256="",
                            source_data={},
                            steps=[],
                            created_by="admin",
                        )
                        for row in rows
                    ],
                )
            else:
                routes.create(connection)
                connection.execute(routes.insert(), rows)
            before = connection.execute(select(routes)).all()
            with Operations.context(MigrationContext.configure(connection)):
                migration().upgrade()
                migration().upgrade()
                archive = migration("20261025_0054_process_route_archives.py")
                archive.upgrade()
                connection.execute(
                    text(
                        "INSERT INTO process_route_archives (route_id,current_route_id,created_at) VALUES (4,5,'2026-10-25 00:00:00')"
                    )
                )
                archive.upgrade()
            assert connection.execute(
                text("SELECT route_id,current_route_id FROM process_route_archives")
            ).all() == [(4, 5)]
            owners = dict(
                connection.execute(
                    text("SELECT serial_no,route_id FROM process_route_serials")
                ).all()
            )
            assert owners == {"s-001": 1, "dup": None, "main": 6, "renamed": 1}
            assert connection.execute(select(routes)).all() == before
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO process_route_serials (serial_no,route_id) VALUES ('s-001',6)"
                    )
                )
    finally:
        engine.dispose()
