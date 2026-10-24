"""Give process engineering a separate directory identity and employee snapshot."""

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "20261024_0049"
down_revision = "20261023_0048"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    columns = {column["name"] for column in sa.inspect(connection).get_columns("process_routes")}
    with op.batch_alter_table("process_routes") as batch:
        if "modified_employee_id" not in columns:
            batch.add_column(sa.Column("modified_employee_id", sa.Integer()))
            batch.create_foreign_key(
                "fk_process_route_modified_employee",
                "team_employees",
                ["modified_employee_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        if "modified_employee_name" not in columns:
            batch.add_column(sa.Column("modified_employee_name", sa.String(80)))
        if "updated_at" not in columns:
            batch.add_column(sa.Column("updated_at", sa.DateTime()))
        if "engineering_employee_id" not in columns:
            batch.add_column(sa.Column("engineering_employee_id", sa.Integer()))
            batch.create_foreign_key(
                "fk_process_route_engineering_employee",
                "team_employees",
                ["engineering_employee_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        if "engineering_employee_name" not in columns:
            batch.add_column(sa.Column("engineering_employee_name", sa.String(80)))
    teams = sa.Table("teams", sa.MetaData(), autoload_with=connection)
    existing = (
        connection.execute(
            sa.select(teams).where(
                sa.or_(teams.c.code == "FACTORY-PROCESS", teams.c.name == "工艺")
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
        ) != ("FACTORY-PROCESS", "工艺", "engineering"):
            raise RuntimeError("工艺班组编码、名称或类型冲突，请先核对，未覆盖已有班组")
        return
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    connection.execute(
        teams.insert().values(
            code="FACTORY-PROCESS",
            name="工艺",
            kind="engineering",
            active=True,
            sort_order=90,
            opening_stock_enabled=False,
            description=None,
            created_at=now,
            updated_at=now,
        )
    )


def downgrade():
    raise RuntimeError("工艺人员记录不可直接删除，请通过备份恢复回退")
