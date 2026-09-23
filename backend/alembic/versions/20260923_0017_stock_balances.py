"""Backfill and reconcile transactional lot balances. Stop writers first."""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0017"
down_revision = "20260920_0016"
branch_labels = None
depends_on = None
PREFIXES = ("received", "on_hand", "reserved", "in_transit", "dispatched", "lost")
AMOUNTS = tuple(f"{prefix}_{amount}" for prefix in PREFIXES for amount in ("quantity", "weight"))


def expected_balances(connection):
    metadata = sa.MetaData()
    mt = sa.Table("material_transfers", metadata, autoload_with=connection)
    ml = sa.Table("material_losses", metadata, autoload_with=connection)
    outbound = (
        sa.select(
            mt.c.source_transfer_id.label("lot_id"),
            *[
                sa.func.sum(sa.case((predicate, mt.c[amount]), else_=0)).label(f"{prefix}_{amount}")
                for prefix, predicate in (
                    ("reserved", mt.c.status == "pending"),
                    ("in_transit", (mt.c.status == "pending") & (mt.c.entry_kind == "transfer")),
                    ("dispatched", mt.c.status.in_(("received", "dispatched"))),
                )
                for amount in ("quantity", "weight")
            ],
        )
        .where(mt.c.source_transfer_id.is_not(None))
        .group_by(mt.c.source_transfer_id)
        .subquery()
    )
    losses = (
        sa.select(
            ml.c.source_transfer_id.label("lot_id"),
            *[
                sa.func.sum(ml.c[amount]).label(f"lost_{amount}")
                for amount in ("quantity", "weight")
            ],
        )
        .group_by(ml.c.source_transfer_id)
        .subquery()
    )
    columns = {}
    for amount in ("quantity", "weight"):
        columns[f"received_{amount}"] = mt.c[amount]
        for prefix, aggregate in (
            ("reserved", outbound),
            ("in_transit", outbound),
            ("dispatched", outbound),
            ("lost", losses),
        ):
            columns[f"{prefix}_{amount}"] = sa.func.coalesce(aggregate.c[f"{prefix}_{amount}"], 0)
        columns[f"on_hand_{amount}"] = sa.func.round(
            mt.c[amount]
            - columns[f"reserved_{amount}"]
            - columns[f"dispatched_{amount}"]
            - columns[f"lost_{amount}"],
            3,
        )
    return (
        sa.select(
            mt.c.id.label("transfer_id"),
            mt.c.next_team_id.label("team_id"),
            *(columns[name].label(name) for name in AMOUNTS),
        )
        .outerjoin(outbound, outbound.c.lot_id == mt.c.id)
        .outerjoin(losses, losses.c.lot_id == mt.c.id)
        .where(mt.c.status == "received", mt.c.stock_tracked.is_(True))
        .subquery()
    )


def upgrade():
    connection = op.get_bind()
    if "material_stock_balances" not in sa.inspect(connection).get_table_names():
        op.create_table(
            "material_stock_balances",
            sa.Column(
                "transfer_id",
                sa.Integer(),
                sa.ForeignKey("material_transfers.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            *(
                sa.Column(
                    name,
                    sa.Numeric(14, 3) if name.endswith("weight") else sa.Integer(),
                    nullable=False,
                )
                for name in AMOUNTS
            ),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            *(sa.CheckConstraint(f"{name} >= 0", name=f"ck_msb_{name}") for name in AMOUNTS),
            *(
                sa.CheckConstraint(
                    f"round(received_{amount}, 3) = round(on_hand_{amount} + reserved_{amount} + dispatched_{amount} + lost_{amount}, 3)",
                    name=f"ck_msb_reconcile_{amount}",
                )
                for amount in ("quantity", "weight")
            ),
            *(
                sa.CheckConstraint(
                    f"in_transit_{amount} <= reserved_{amount}", name=f"ck_msb_transit_{amount}"
                )
                for amount in ("quantity", "weight")
            ),
        )
    indexes = {
        index["name"]: index["column_names"]
        for index in sa.inspect(connection).get_indexes("material_stock_balances")
    }
    if "ix_msb_team_lot" not in indexes:
        op.create_index("ix_msb_team_lot", "material_stock_balances", ["team_id", "transfer_id"])
    elif indexes["ix_msb_team_lot"] != ["team_id", "transfer_id"]:
        raise RuntimeError("Unexpected stock balance index; inspect before retrying")
    expected = expected_balances(connection)
    if connection.execute(
        sa.select(expected.c.transfer_id)
        .where(sa.or_(*(expected.c[name] < 0 for name in AMOUNTS)))
        .limit(1)
    ).first():
        raise RuntimeError("Negative historical stock; reconcile ledger before migrating")
    table = sa.Table("material_stock_balances", sa.MetaData(), autoload_with=connection)
    # Resume interrupted MySQL DDL/backfill without overwriting existing balances.
    columns = ("transfer_id", "team_id", *AMOUNTS)
    connection.execute(
        table.insert().from_select(
            (*columns, "updated_at"),
            sa.select(*(expected.c[name] for name in columns), sa.func.current_timestamp()).where(
                ~sa.exists(
                    sa.select(table.c.transfer_id).where(
                        table.c.transfer_id == expected.c.transfer_id
                    )
                )
            ),
        )
    )
    mismatched = (
        sa.select(expected.c.transfer_id)
        .outerjoin(table, table.c.transfer_id == expected.c.transfer_id)
        .where(
            sa.or_(
                table.c.transfer_id.is_(None),
                *(table.c[name] != expected.c[name] for name in columns[1:]),
            )
        )
    )
    extra = sa.select(table.c.transfer_id).where(
        ~sa.exists(
            sa.select(expected.c.transfer_id).where(expected.c.transfer_id == table.c.transfer_id)
        )
    )
    if (
        connection.execute(mismatched.limit(1)).first()
        or connection.execute(extra.limit(1)).first()
    ):
        raise RuntimeError(
            "Stock balance reconciliation failed; stop and inspect, do not overwrite"
        )


def downgrade():
    raise RuntimeError("Restore a verified backup together with the previous application version")
