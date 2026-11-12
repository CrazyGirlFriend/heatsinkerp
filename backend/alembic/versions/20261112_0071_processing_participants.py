"""Record shared processing participants and actual elapsed minutes."""

import sqlalchemy as sa
from alembic import op

revision = "20261112_0071"
down_revision = "20261109_0070"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "material_quantity_adjustments", sa.Column("processor_group_key", sa.String(1024))
    )
    op.add_column("material_quantity_adjustments", sa.Column("processing_minutes", sa.Integer()))
    op.create_table(
        "processing_participants",
        sa.Column(
            "processing_id",
            sa.Integer(),
            sa.ForeignKey("material_quantity_adjustments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("team_employees.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("name", sa.String(80), nullable=False),
    )
    op.create_index(
        "ix_processing_participants_employee_id", "processing_participants", ["employee_id"]
    )
    connection = op.get_bind()
    work = sa.table(
        "material_quantity_adjustments",
        sa.column("id"),
        sa.column("processor_employee_id"),
        sa.column("processor_name"),
        sa.column("processor_group_key"),
    )
    employees = sa.table("team_employees", sa.column("id"), sa.column("name"))
    participants = sa.table(
        "processing_participants",
        sa.column("processing_id"),
        sa.column("employee_id"),
        sa.column("name"),
    )
    connection.execute(
        participants.insert().from_select(
            ["processing_id", "employee_id", "name"],
            sa.select(
                work.c.id,
                work.c.processor_employee_id,
                sa.func.coalesce(work.c.processor_name, employees.c.name),
            ).join(employees, employees.c.id == work.c.processor_employee_id),
        )
    )
    connection.execute(
        work.update()
        .where(work.c.processor_employee_id.is_not(None))
        .values(processor_group_key=sa.cast(work.c.processor_employee_id, sa.String(1024)))
    )


def downgrade():
    op.drop_table("processing_participants")
    op.drop_column("material_quantity_adjustments", "processing_minutes")
    op.drop_column("material_quantity_adjustments", "processor_group_key")
