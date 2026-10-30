"""Dispatch ownership, customer batches, team proposals and order locks."""

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "20261030_0062"
down_revision = "20261029_0061"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("production_schedule_tasks", sa.Column("delivery_batches", sa.JSON()))
    op.add_column("production_schedule_tasks", sa.Column("locked_at", sa.DateTime()))
    op.add_column("production_schedule_tasks", sa.Column("cancelled_at", sa.DateTime()))
    op.add_column(
        "production_schedules",
        sa.Column("planning_state", sa.String(16), nullable=False, server_default="confirmed"),
    )
    op.add_column("production_schedules", sa.Column("pending_batches", sa.JSON()))
    op.create_table(
        "production_schedule_task_people",
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("production_schedule_tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "person_id",
            sa.Integer(),
            sa.ForeignKey("business_people.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO production_schedule_task_people (task_id, person_id) SELECT id, business_person_id FROM production_schedule_tasks WHERE business_person_id IS NOT NULL"
        )
    )
    teams = sa.Table("teams", sa.MetaData(), autoload_with=connection)
    existing = (
        connection.execute(
            sa.select(teams).where(
                sa.or_(teams.c.code == "FACTORY-DISPATCH", teams.c.name == "调度")
            )
        )
        .mappings()
        .all()
    )
    if existing:
        if len(existing) != 1 or (
            existing[0]["code"],
            existing[0]["name"],
            existing[0]["kind"],
        ) != ("FACTORY-DISPATCH", "调度", "dispatch"):
            raise RuntimeError("调度班组编码、名称或类型冲突，请先核对")
    else:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        connection.execute(
            teams.insert().values(
                code="FACTORY-DISPATCH",
                name="调度",
                kind="dispatch",
                active=True,
                sort_order=100,
                opening_stock_enabled=False,
                created_at=now,
                updated_at=now,
            )
        )

    business = (
        connection.execute(
            sa.select(teams).where(
                sa.or_(teams.c.code == "FACTORY-BUSINESS", teams.c.name == "业务")
            )
        )
        .mappings()
        .all()
    )
    if business:
        if len(business) != 1 or (
            business[0]["code"],
            business[0]["name"],
            business[0]["kind"],
        ) != ("FACTORY-BUSINESS", "业务", "business"):
            raise RuntimeError("业务班组编码、名称或类型冲突，请先核对")
    else:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        connection.execute(
            teams.insert().values(
                code="FACTORY-BUSINESS",
                name="业务",
                kind="business",
                active=True,
                sort_order=110,
                opening_stock_enabled=False,
                created_at=now,
                updated_at=now,
            )
        )


def downgrade():
    raise RuntimeError("已有调度与确认记录，请通过备份恢复回退")
