"""Keep reviewed Word routes and immutable per-lot process positions."""

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import LONGBLOB

revision = "20261023_0047"
down_revision = "20261023_0046"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if not inspector.has_table("process_routes"):
        op.create_table(
            "process_routes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(160), nullable=False),
            sa.Column("filename", sa.String(240), nullable=False),
            sa.Column("source_sha256", sa.String(64), nullable=False),
            sa.Column(
                "source_file", sa.LargeBinary().with_variant(LONGBLOB(), "mysql"), nullable=False
            ),
            sa.Column("source_data", sa.JSON(), nullable=False),
            sa.Column("serial_nos", sa.JSON(), nullable=False),
            sa.Column("steps", sa.JSON(), nullable=False),
            sa.Column("review_note", sa.Text()),
            sa.Column(
                "parent_id", sa.Integer(), sa.ForeignKey("process_routes.id", ondelete="RESTRICT")
            ),
            sa.Column("state", sa.String(16), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("created_by", sa.String(80), nullable=False),
            sa.Column(
                "created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("published_at", sa.DateTime()),
        )
        op.create_index("ix_process_routes_created", "process_routes", ["created_at", "id"])
        op.create_index(
            "ix_process_routes_created_by_user_id", "process_routes", ["created_by_user_id"]
        )
    if "created_by_user_id" not in {
        column["name"] for column in sa.inspect(connection).get_columns("process_routes")
    }:
        with op.batch_alter_table("process_routes") as batch:
            batch.add_column(sa.Column("created_by_user_id", sa.Integer()))
            batch.create_foreign_key(
                "fk_process_routes_created_by_user",
                "users",
                ["created_by_user_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch.create_index("ix_process_routes_created_by_user_id", ["created_by_user_id"])
    if not inspector.has_table("process_route_paths"):
        op.create_table(
            "process_route_paths",
            sa.Column(
                "route_id",
                sa.Integer(),
                sa.ForeignKey("process_routes.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            sa.Column("serial_no", sa.String(80), primary_key=True),
            sa.Column("step_index", sa.Integer(), primary_key=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
        )
    if not inspector.has_table("process_route_policy"):
        op.create_table(
            "process_route_policy",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
            sa.Column("enforced_after", sa.DateTime(), nullable=False),
        )
    policy = sa.table(
        "process_route_policy", sa.column("id"), sa.column("enforced_after", sa.DateTime())
    )
    if not connection.scalar(sa.select(policy.c.id).where(policy.c.id == 1)):
        connection.execute(
            policy.insert().values(
                id=1, enforced_after=datetime.now(timezone.utc).replace(tzinfo=None)
            )
        )
    for table in ("material_transfers", "material_quantity_adjustments", "production_schedules"):
        inspector = sa.inspect(connection)
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "process_route_id" not in columns:
            with op.batch_alter_table(table) as batch:
                batch.add_column(sa.Column("process_route_id", sa.Integer()))
                batch.add_column(sa.Column("process_step_index", sa.Integer()))
                batch.create_foreign_key(
                    "fk_" + table + "_route",
                    "process_routes",
                    ["process_route_id"],
                    ["id"],
                    ondelete="RESTRICT",
                )
                if table != "material_quantity_adjustments":
                    batch.create_index("ix_" + table + "_process_route_id", ["process_route_id"])
                if table == "material_transfers":
                    batch.add_column(sa.Column("sent_process_step_index", sa.Integer()))
                    batch.add_column(
                        sa.Column(
                            "process_step_complete", sa.Boolean(), nullable=True, server_default="0"
                        )
                    )
                if table == "material_quantity_adjustments":
                    batch.add_column(sa.Column("process_step_name", sa.String(120)))

    if "process_step" not in {
        column["name"] for column in sa.inspect(connection).get_columns("material_inspections")
    }:
        op.add_column("material_inspections", sa.Column("process_step", sa.JSON()))


def downgrade():
    raise RuntimeError("工艺执行历史不可删除，请通过恢复备份回退")
