import gzip
import hashlib
from types import SimpleNamespace

import pytest
from app import reset_business_data as reset
from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
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
        "barcode_sequence",
    ):
        columns = [Column("id", Integer, primary_key=True), Column("value", String)]
        if name == "material_transfers":
            columns += [
                Column(
                    "source_transfer_id", ForeignKey("material_transfers.id", ondelete="RESTRICT")
                ),
                Column("dispatch_id", ForeignKey("material_dispatches.id", ondelete="RESTRICT")),
                Column(
                    "opening_stock_id",
                    ForeignKey("opening_stock_submissions.id", ondelete="RESTRICT"),
                ),
            ]
        if name in ("material_losses", "material_transfer_events"):
            columns += [
                Column("transfer_id", ForeignKey("material_transfers.id", ondelete="RESTRICT"))
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
