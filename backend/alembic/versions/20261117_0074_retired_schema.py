"""Remove retired inboxes and store scheduling contacts in one relation.

Deploy with the existing stop-writes / full-backup workflow. Retired messages
and the old serial-wide delivery plans are recoverable from that backup only.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261117_0074"
down_revision = "20261115_0073"
branch_labels = None
depends_on = None

RETIRED_TABLES = (
    "schedule_notice_reads",
    "schedule_notices",
    "quality_notice_reads",
    "quality_notices",
    "rework_notice_reads",
    "rework_notices",
    "transfer_amendment_notice_reads",
    "transfer_amendment_notices",
    "serial_delivery_plans",
)


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    table = "production_schedule_tasks"
    columns = {column["name"] for column in inspector.get_columns(table)}
    removed = columns & {"business_person_id", "locked_at"}
    if removed and connection.dialect.name == "sqlite":
        if connection.exec_driver_sql("PRAGMA foreign_keys").scalar():
            raise RuntimeError(
                "SQLite 表重建需先停止写入并关闭 foreign_keys，完成后执行 foreign_key_check"
            )
    if "business_person_id" in removed:
        metadata = sa.MetaData()
        tasks = sa.Table(table, metadata, autoload_with=connection)
        people = sa.Table("production_schedule_task_people", metadata, autoload_with=connection)
        # Preserve every legacy contact, including disabled people and contacts
        # missing from an existing multi-person assignment. Retrying adds no duplicates.
        missing = (
            sa.select(tasks.c.id, tasks.c.business_person_id)
            .outerjoin(
                people,
                sa.and_(
                    people.c.task_id == tasks.c.id,
                    people.c.person_id == tasks.c.business_person_id,
                ),
            )
            .where(tasks.c.business_person_id.is_not(None), people.c.task_id.is_(None))
        )
        connection.execute(people.insert().from_select(["task_id", "person_id"], missing))
    if removed:
        with op.batch_alter_table(
            table,
            naming_convention={"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"},
        ) as batch:
            for fk in inspector.get_foreign_keys(table):
                if removed.intersection(fk["constrained_columns"]):
                    batch.drop_constraint(
                        fk["name"] or f"fk_{table}_business_person_id_business_people",
                        type_="foreignkey",
                    )
            for index in inspector.get_indexes(table):
                if removed.intersection(index["column_names"]):
                    batch.drop_index(index["name"])
            for column in sorted(removed):
                batch.drop_column(column)
    for name in RETIRED_TABLES:
        if inspector.has_table(name):
            op.drop_table(name)


def downgrade():
    raise RuntimeError("已删除停用通知和旧交付计划；请恢复迁移前的完整备份及对应程序版本")
