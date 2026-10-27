import gzip
import hashlib
from types import SimpleNamespace

import pytest
from app import reset_business_data as reset
from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    create_engine,
    event,
    select,
)
from sqlalchemy.orm import Session


@pytest.fixture()
def database(monkeypatch):
    engine = create_engine("sqlite://")
    event.listen(
        engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON")
    )
    metadata = MetaData()
    for name in (
        *reset.RESET_TABLES,
        "users",
        "work_orders",
        "admin_audit_events",
        "team_purposes",
        "inspection_problem_types",
        "barcode_sequence",
    ):
        columns = [Column("id", Integer, primary_key=True), Column("value", String)]
        if name == "material_transfers":
            columns += [
                Column(
                    "processing_schedule_id",
                    ForeignKey("production_schedules.id", ondelete="RESTRICT"),
                ),
                Column(
                    "source_transfer_id", ForeignKey("material_transfers.id", ondelete="RESTRICT")
                ),
                Column(
                    "delivery_origin_id", ForeignKey("material_transfers.id", ondelete="RESTRICT")
                ),
                Column("dispatch_id", ForeignKey("material_dispatches.id", ondelete="RESTRICT")),
                Column(
                    "shared_group_id", ForeignKey("shared_material_groups.id", ondelete="RESTRICT")
                ),
                Column(
                    "opening_stock_id",
                    ForeignKey("opening_stock_submissions.id", ondelete="RESTRICT"),
                ),
            ]
        if name in ("material_losses", "material_transfer_events"):
            columns += [
                Column("transfer_id", ForeignKey("material_transfers.id", ondelete="RESTRICT"))
            ]
        reference = {
            "production_schedules": "predecessor_id",
            "material_quantity_adjustments": "rework_of_id",
            "material_inspections": "parent_id",
        }.get(name)
        if reference:
            columns += [
                Column(reference, ForeignKey(f"{name}.id", ondelete="RESTRICT")),
                Column(
                    "source_transfer_id", ForeignKey("material_transfers.id", ondelete="RESTRICT")
                ),
            ]
        if name == "material_quantity_adjustments":
            columns += [
                Column(
                    "production_schedule_id",
                    ForeignKey("production_schedules.id", ondelete="RESTRICT"),
                )
            ]
        if name == "shared_material_members":
            columns += [
                Column("group_id", ForeignKey("shared_material_groups.id", ondelete="RESTRICT"))
            ]
        if name == "inspection_problems":
            columns += [
                Column("inspection_id", ForeignKey("material_inspections.id", ondelete="RESTRICT")),
                Column(
                    "problem_type_id",
                    ForeignKey("inspection_problem_types.id", ondelete="RESTRICT"),
                ),
            ]
        Table(name, metadata, *columns)
    metadata.create_all(engine)
    monkeypatch.setattr(reset, "Base", SimpleNamespace(metadata=metadata))
    with engine.begin() as connection:
        for name, table in metadata.tables.items():
            if name not in ("material_transfers", "material_losses", "material_transfer_events"):
                connection.execute(table.insert(), {"id": 1, "value": "keep"})
        transfers = metadata.tables["material_transfers"]
        connection.execute(transfers.insert(), {"id": 1, "opening_stock_id": 1})
        connection.execute(transfers.insert(), {"id": 2, "source_transfer_id": 1, "dispatch_id": 1})
        for name in ("material_losses", "material_transfer_events"):
            connection.execute(metadata.tables[name].insert(), {"id": 1, "transfer_id": 2})
        connection.execute(metadata.tables["material_transfers"].update().values(shared_group_id=1))
        connection.execute(metadata.tables["shared_material_members"].update().values(group_id=1))
        connection.execute(
            metadata.tables["inspection_problems"]
            .update()
            .values(inspection_id=1, problem_type_id=1)
        )
    try:
        yield engine, metadata
    finally:
        engine.dispose()


def contents(engine, metadata):
    with engine.connect() as connection:
        return {
            name: connection.execute(select(table)).all() for name, table in metadata.tables.items()
        }


def test_material_only_reset_preserves_history_and_is_repeatable(database):
    engine, metadata = database
    before = contents(engine, metadata)
    with Session(engine) as db:
        counts = reset.reset_business_data(db)
        assert counts["material_transfers"] == 2
        assert counts["opening_stock_submissions"] == counts["serial_urgencies"] == 1
        assert set(reset.reset_business_data(db).values()) == {0}
    after = contents(engine, metadata)
    for name in metadata.tables:
        assert after[name] == ([] if name in reset.RESET_TABLES else before[name])


def test_reset_respects_delivery_origin_reference_without_stock_source(database):
    engine, metadata = database
    with engine.begin() as connection:
        connection.execute(
            metadata.tables["material_transfers"].insert(), {"id": 3, "delivery_origin_id": 1}
        )
    with Session(engine) as db:
        assert reset.reset_business_data(db)["material_transfers"] == 3


def test_reset_removes_material_commitment_links_with_foreign_keys_enabled(database):
    engine, metadata = database
    with engine.begin() as connection:
        connection.execute(
            metadata.tables["material_transfers"].update().values(processing_schedule_id=1)
        )
        connection.execute(
            metadata.tables["material_quantity_adjustments"]
            .update()
            .values(production_schedule_id=1)
        )
    before = contents(engine, metadata)
    with Session(engine) as db:
        reset.reset_business_data(db)
    after = contents(engine, metadata)
    for name in metadata.tables:
        assert after[name] == ([] if name in reset.RESET_TABLES else before[name])


@pytest.mark.parametrize("reference", [None, *reset.PROTECTED_ROUTE_REFERENCES])
def test_reset_preserves_engineering_originals_and_refuses_actual_references(database, reference):
    engine, metadata = database
    routes = Table(
        "process_routes",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("source_file", LargeBinary),
        *[
            Column(column, ForeignKey(f"{target}.id", ondelete="RESTRICT"))
            for column, target in reset.PROTECTED_ROUTE_REFERENCES.items()
        ],
    )
    drawings = Table(
        "process_route_drawings",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("route_id", ForeignKey("process_routes.id", ondelete="RESTRICT")),
        Column("source_file", LargeBinary),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(routes.insert(), {"id": 1, "source_file": b"original Word"})
        connection.execute(
            drawings.insert(), {"id": 1, "route_id": 1, "source_file": b"original PDF"}
        )
        if reference:
            connection.execute(routes.update().values({reference: 1}))
    before = contents(engine, metadata)
    with Session(engine) as db:
        if reference:
            with pytest.raises(RuntimeError, match="Protected engineering references"):
                reset.reset_business_data(db)
        else:
            reset.reset_business_data(db)
    after = contents(engine, metadata)
    for name in metadata.tables:
        assert after[name] == ([] if not reference and name in reset.RESET_TABLES else before[name])


def test_reset_removes_rechecks_and_rework_before_their_original_records(database):
    engine, metadata = database
    with engine.begin() as connection:
        for name, reference in (
            ("production_schedules", "predecessor_id"),
            ("material_inspections", "parent_id"),
            ("material_quantity_adjustments", "rework_of_id"),
        ):
            table = metadata.tables[name]
            connection.execute(table.update().values(source_transfer_id=2))
            for row_id in (2, 3):
                connection.execute(
                    table.insert(),
                    {
                        "id": row_id,
                        reference: row_id - 1,
                        "source_transfer_id": 2,
                    },
                )
            # Model MySQL's immediate per-row RESTRICT check, including self references.
            connection.exec_driver_sql(f"""CREATE TRIGGER restrict_{name} BEFORE DELETE ON {name}
                WHEN EXISTS (SELECT 1 FROM {name} WHERE {reference} = OLD.id)
                BEGIN SELECT RAISE(ABORT, 'history still referenced'); END""")
    before = contents(engine, metadata)
    with Session(engine) as db:
        deleted = reset.reset_business_data(db)
    assert (
        deleted["material_inspections"]
        == deleted["material_quantity_adjustments"]
        == deleted["production_schedules"]
        == 3
    )
    after = contents(engine, metadata)
    for name in metadata.tables:
        assert after[name] == ([] if name in reset.RESET_TABLES else before[name])


@pytest.mark.parametrize("failure", ["cycle", "dependent", "trigger"])
def test_reset_rolls_back_or_refuses_unapproved_changes(database, failure):
    engine, metadata = database
    with engine.begin() as connection:
        if failure == "cycle":
            connection.exec_driver_sql(
                "UPDATE material_transfers SET source_transfer_id = 2 WHERE id = 1"
            )
        elif failure == "dependent":
            connection.exec_driver_sql(
                "CREATE TABLE future_records (id INTEGER PRIMARY KEY, transfer_id INTEGER REFERENCES material_transfers(id) ON DELETE CASCADE)"
            )
            connection.exec_driver_sql("INSERT INTO future_records VALUES (1, 2)")
        else:
            connection.exec_driver_sql(
                "CREATE TRIGGER unexpected AFTER DELETE ON material_transfers BEGIN UPDATE users SET value = 'changed'; END"
            )
    before = contents(engine, metadata)
    with Session(engine) as db, pytest.raises(RuntimeError):
        reset.reset_business_data(db)
    assert contents(engine, metadata) == before
    if failure == "dependent":
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT count(*) FROM future_records").scalar() == 1


@pytest.mark.parametrize("invalid", ["database", "checksum", "maintenance", "empty_gzip"])
def test_cli_refuses_unverified_reset_before_opening_database(tmp_path, monkeypatch, invalid):
    backup = tmp_path / "backup.sql.gz"
    backup.write_bytes(gzip.compress(b"" if invalid == "empty_gzip" else b"local test backup"))
    checksum = hashlib.sha256(backup.read_bytes()).hexdigest()
    args = [
        "reset",
        "--apply",
        "--confirm-database",
        "wrong" if invalid == "database" else "test",
        "--backup-file",
        str(backup),
        "--backup-sha256",
        "wrong" if invalid == "checksum" else checksum,
    ]
    if invalid != "maintenance":
        args.append("--maintenance-confirmed")
    monkeypatch.setattr("sys.argv", args)
    monkeypatch.setattr(reset, "engine", SimpleNamespace(url=SimpleNamespace(database="test")))

    def forbidden():
        pytest.fail("An invalid reset must not open a database session")

    monkeypatch.setattr(reset, "SessionLocal", forbidden)
    with pytest.raises(SystemExit) as error:
        reset.main()
    assert error.value.code == 2
