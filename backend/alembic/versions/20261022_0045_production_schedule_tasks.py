"""Group existing delivery nodes into tasks without changing past completion rules."""

import sqlalchemy as sa
from alembic import op

revision = "20261022_0045"
down_revision = "20261022_0044"
branch_labels = None
depends_on = None

BASIS_CHECK = (
    "(completion_basis = 'quantity' AND target_quantity IS NOT NULL) OR "
    "(completion_basis = 'weight' AND target_weight IS NOT NULL) OR "
    "(completion_basis = 'both' AND target_quantity IS NOT NULL AND target_weight IS NOT NULL)"
)


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if not inspector.has_table("production_schedule_tasks"):
        op.create_table(
            "production_schedule_tasks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(160), nullable=False),
            sa.Column("serial_no", sa.String(80), nullable=False),
            sa.Column("notes", sa.Text()),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.CheckConstraint("version > 0", name="ck_pst_positive_revision"),
        )
        op.create_index("ix_pst_serial", "production_schedule_tasks", ["serial_no", "id"])
    columns = {item["name"]: item for item in inspector.get_columns("production_schedules")}
    if "task_id" not in columns:
        op.add_column("production_schedules", sa.Column("task_id", sa.Integer()))
    if "completion_basis" not in columns:
        op.add_column("production_schedules", sa.Column("completion_basis", sa.String(16)))
    metadata = sa.MetaData()
    nodes = sa.Table("production_schedules", metadata, autoload_with=connection)
    tasks = sa.Table("production_schedule_tasks", metadata, autoload_with=connection)
    parent = nodes.alias("parent")
    # Old predecessor chains are one task, while independent roots sharing a serial remain separate.
    roots = sa.and_(nodes.c.task_id.is_(None), nodes.c.predecessor_id.is_(None))
    connection.execute(
        tasks.insert().from_select(
            [
                "id",
                "title",
                "serial_no",
                "version",
                "created_at",
                "updated_at",
                "idempotency_key",
                "request_hash",
            ],
            sa.select(
                nodes.c.id,
                nodes.c.serial_no + " 交货排期",
                nodes.c.serial_no,
                sa.literal(1),
                nodes.c.created_at,
                nodes.c.updated_at,
                sa.literal("migration-node-") + sa.cast(nodes.c.id, sa.String()),
                sa.literal("0" * 64),
            ).where(roots, ~sa.exists(sa.select(tasks.c.id).where(tasks.c.id == nodes.c.id))),
        )
    )
    connection.execute(nodes.update().where(roots).values(task_id=nodes.c.id))
    while True:
        changed = connection.execute(
            nodes.update()
            .where(
                nodes.c.task_id.is_(None),
                nodes.c.predecessor_id == parent.c.id,
                parent.c.task_id.is_not(None),
                parent.c.serial_no == nodes.c.serial_no,
            )
            .values(task_id=parent.c.task_id)
        ).rowcount
        if not changed:
            break
    if connection.scalar(
        sa.select(sa.func.count()).select_from(nodes).where(nodes.c.task_id.is_(None))
    ):
        raise RuntimeError("排期前序存在循环、缺失或跨流水号关联；请修复后重试迁移")
    connection.execute(
        nodes.update()
        .where(nodes.c.completion_basis.is_(None))
        .values(
            completion_basis=sa.case(
                (
                    sa.and_(
                        nodes.c.target_quantity.is_not(None), nodes.c.target_weight.is_not(None)
                    ),
                    "both",
                ),
                (nodes.c.target_quantity.is_not(None), "quantity"),
                else_="weight",
            )
        )
    )
    inspector = sa.inspect(connection)
    columns = {item["name"]: item for item in inspector.get_columns("production_schedules")}
    has_task_fk = any(
        item["constrained_columns"] == ["task_id"]
        and item["referred_table"] == "production_schedule_tasks"
        and item["referred_columns"] == ["id"]
        for item in inspector.get_foreign_keys("production_schedules")
    )
    checks = {item["name"] for item in inspector.get_check_constraints("production_schedules")}
    if (
        columns["task_id"]["nullable"]
        or columns["completion_basis"]["nullable"]
        or not has_task_fk
        or "ck_ps_completion_basis" not in checks
    ):
        with op.batch_alter_table("production_schedules") as batch:
            if columns["task_id"]["nullable"]:
                batch.alter_column("task_id", existing_type=sa.Integer(), nullable=False)
            if columns["completion_basis"]["nullable"]:
                batch.alter_column("completion_basis", existing_type=sa.String(16), nullable=False)
            if not has_task_fk:
                batch.create_foreign_key(
                    "fk_ps_task",
                    "production_schedule_tasks",
                    ["task_id"],
                    ["id"],
                    ondelete="RESTRICT",
                )
            if "ck_ps_completion_basis" not in checks:
                batch.create_check_constraint("ck_ps_completion_basis", BASIS_CHECK)
    if "ix_ps_task_sequence" not in {
        item["name"] for item in sa.inspect(connection).get_indexes("production_schedules")
    }:
        op.create_index(
            "ix_ps_task_sequence", "production_schedules", ["task_id", "sequence_no", "id"]
        )


def downgrade():
    raise RuntimeError(
        "Preserve scheduling tasks, node ownership and completion history on rollback"
    )
