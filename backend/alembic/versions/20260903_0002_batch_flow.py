"""Add batch reports, partial receipts, and the exception quantity ledger.

Revision ID: 20260903_0002
Revises: 20260901_0001

The original 0001 creates the then-current ORM metadata. Consequently an empty
database can already contain this schema after 0001, while an existing database
still has the old one-report/one-receipt unique constraints. Inspect each change
instead of assuming either starting state. Existing business rows are not edited.

SQLite uses Alembic's documented batch-copy mechanism to preserve row IDs and
foreign keys. MySQL only alters the relevant columns, constraints, and indexes.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260903_0002"
down_revision = "20260901_0001"
branch_labels = None
depends_on = None

NAMING_CONVENTION = {
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _inspector():
    # Reflection results are cached: always inspect afresh after DDL.
    return sa.inspect(op.get_bind())


def _column_names(table):
    return {column["name"] for column in _inspector().get_columns(table)}


def _ensure_index(table, name, columns):
    if not any(
        not index["unique"] and index["column_names"] == columns
        for index in _inspector().get_indexes(table)
    ):
        op.create_index(name, table, columns, unique=False)


def _single_column_uniques(table, column):
    return [
        constraint
        for constraint in _inspector().get_unique_constraints(table)
        if constraint["column_names"] == [column]
    ]


def _drop_legacy_unique(batch, table, column, constraints):
    for constraint in constraints:
        # SQLite permits unnamed unique constraints. Batch reflection assigns
        # the convention name so it can be addressed without rebuilding by hand.
        name = constraint["name"] or f"uq_{table}_{column}"
        batch.drop_constraint(name, type_="unique")


def _upgrade_teams():
    existing = _column_names("teams")
    if "sort_order" not in existing:
        op.add_column("teams", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
    if "kind" not in existing:
        op.add_column("teams", sa.Column("kind", sa.String(16), nullable=False, server_default="production"))


def _upgrade_reports():
    table = "operation_reports"
    existing = _column_names(table)
    additions = [
        sa.Column("lost_quantity", sa.Numeric(14, 3), nullable=False, server_default="0"),
        sa.Column("scrap_reason", sa.Text(), nullable=True),
        sa.Column("loss_reason", sa.Text(), nullable=True),
        sa.Column("scrap_destination_team_id", sa.Integer(), nullable=True),
        sa.Column("scrap_destination_team_name", sa.String(120), nullable=True),
        sa.Column("idempotency_key", sa.String(100), nullable=True),
        sa.Column("request_hash", sa.String(64), nullable=True),
    ]
    missing = [column for column in additions if column.name not in existing]
    legacy_uniques = _single_column_uniques(table, "operation_id")
    has_request_unique = any(
        constraint["column_names"] == ["operation_id", "idempotency_key"]
        for constraint in _inspector().get_unique_constraints(table)
    )
    has_destination_fk = any(
        fk["constrained_columns"] == ["scrap_destination_team_id"]
        and fk["referred_table"] == "teams"
        for fk in _inspector().get_foreign_keys(table)
    )
    # On MySQL the old unique index may support the operation FK. Add a normal
    # replacement first, otherwise dropping the unique index can be rejected.
    _ensure_index(table, "ix_operation_reports_operation_id", ["operation_id"])
    if missing or legacy_uniques or not has_request_unique or not has_destination_fk:
        with op.batch_alter_table(table, naming_convention=NAMING_CONVENTION) as batch:
            for column in missing:
                batch.add_column(column)
            _drop_legacy_unique(batch, table, "operation_id", legacy_uniques)
            if not has_request_unique:
                batch.create_unique_constraint("uq_report_operation_key", ["operation_id", "idempotency_key"])
            if not has_destination_fk:
                batch.create_foreign_key(
                    "fk_reports_scrap_destination_team", "teams",
                    ["scrap_destination_team_id"], ["id"], ondelete="SET NULL",
                )
    _ensure_index(table, "ix_operation_reports_scrap_destination_team_id", ["scrap_destination_team_id"])


def _upgrade_receipts():
    table = "operation_receipts"
    # Preserve this FK as well when removing the old one-receipt restriction.
    _ensure_index(table, "ix_receipts_report", ["report_id"])
    legacy_uniques = _single_column_uniques(table, "report_id")
    if legacy_uniques:
        with op.batch_alter_table(table, naming_convention=NAMING_CONVENTION) as batch:
            _drop_legacy_unique(batch, table, "report_id", legacy_uniques)


def _upgrade_exceptions():
    table = "operation_exceptions"
    if table not in _inspector().get_table_names():
        op.create_table(
            table,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("work_order_id", sa.Integer(), nullable=False),
            sa.Column("operation_id", sa.Integer(), nullable=False),
            sa.Column("report_id", sa.Integer(), nullable=True),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("destination_team_id", sa.Integer(), nullable=True),
            sa.Column("destination_team_name", sa.String(120), nullable=True),
            sa.Column("operator", sa.String(80), nullable=False),
            sa.Column("operator_user_id", sa.Integer(), nullable=True),
            sa.Column("operator_team_id", sa.Integer(), nullable=True),
            sa.Column("operator_team_name", sa.String(120), nullable=True),
            sa.Column("idempotency_key", sa.String(100), nullable=False),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["work_order_id"], ["work_orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["operation_id"], ["operations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["report_id"], ["operation_reports.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["destination_team_id"], ["teams.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["operator_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["operator_team_id"], ["teams.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("idempotency_key", name="uq_exception_idempotency_key"),
        )
    for column in (
        "work_order_id", "operation_id", "report_id", "destination_team_id",
        "operator_user_id", "operator_team_id",
    ):
        _ensure_index(table, f"ix_{table}_{column}", [column])


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        needs_batch_copy = (
            _single_column_uniques("operation_reports", "operation_id")
            or _single_column_uniques("operation_receipts", "report_id")
        )
        if needs_batch_copy and bind.exec_driver_sql("PRAGMA foreign_keys").scalar():
            # Do not disable integrity inside an existing transaction (SQLite
            # silently ignores that PRAGMA). Refuse before touching business data.
            raise RuntimeError(
                "SQLite batch migration requires a dedicated migration connection "
                "with PRAGMA foreign_keys=OFF before its transaction; validate "
                "PRAGMA foreign_key_check after upgrading. MySQL is unaffected."
            )
    _upgrade_teams()
    _upgrade_reports()
    _upgrade_receipts()
    _upgrade_exceptions()
    if bind.dialect.name == "sqlite":
        violations = bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError("Foreign-key violations found after batch-flow migration")


def downgrade() -> None:
    # Multiple batches/receipts and reasoned exceptions have no lossless legacy
    # representation. Never silently drop them or merge their audit histories.
    raise RuntimeError(
        "Batch-flow migration cannot be safely downgraded in place. Restore the "
        "verified pre-upgrade database backup together with its previous release."
    )
