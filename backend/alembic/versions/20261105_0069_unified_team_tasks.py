"""Share receiving and processing task choices without rewriting historical records."""

import sqlalchemy as sa
from alembic import op

revision = "20261105_0069"
down_revision = "20261105_0068"
branch_labels = None
depends_on = None

PRODUCTION_CODES = (
    "FACTORY-ROLL",
    "FACTORY-ANNEAL",
    "FACTORY-GRIND",
    "FACTORY-WIRE",
    "FACTORY-ENGRAVE",
    "FACTORY-PLATE",
    "FACTORY-QC",
)


def upgrade():
    with op.batch_alter_table("team_processing_tasks") as batch:
        batch.add_column(sa.Column("purpose_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_processing_task_purpose",
            "team_purposes",
            ["purpose_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_unique_constraint("uq_processing_task_purpose", ["purpose_id"])
    connection = op.get_bind()
    metadata = sa.MetaData()
    teams = sa.Table("teams", metadata, autoload_with=connection)
    purposes = sa.Table("team_purposes", metadata, autoload_with=connection)
    tasks = sa.Table("team_processing_tasks", metadata, autoload_with=connection)
    team_ids = connection.scalars(
        sa.select(teams.c.id).where(teams.c.code.in_(PRODUCTION_CODES))
    ).all()
    for team_id in team_ids:
        purpose_rows = {
            row.name: row
            for row in connection.execute(sa.select(purposes).where(purposes.c.team_id == team_id))
        }
        task_rows = {
            row.name: row
            for row in connection.execute(sa.select(tasks).where(tasks.c.team_id == team_id))
        }
        for name in sorted(purpose_rows.keys() | task_rows.keys()):
            purpose, task = purpose_rows.get(name), task_rows.get(name)
            active = bool((purpose is None or purpose.active) and (task is None or task.active))
            if purpose is None:
                purpose_id = connection.execute(
                    purposes.insert().values(
                        team_id=team_id,
                        name=name,
                        active=active,
                        version=1,
                        updated_at=sa.func.now(),
                    )
                ).inserted_primary_key[0]
            else:
                purpose_id = purpose.id
                if purpose.active != active:
                    connection.execute(
                        purposes.update()
                        .where(purposes.c.id == purpose_id)
                        .values(active=active, version=purpose.version + 1)
                    )
            if task is None:
                connection.execute(
                    tasks.insert().values(
                        team_id=team_id,
                        name=name,
                        active=active,
                        version=1,
                        updated_at=sa.func.now(),
                        purpose_id=purpose_id,
                    )
                )
            else:
                connection.execute(
                    tasks.update()
                    .where(tasks.c.id == task.id)
                    .values(
                        purpose_id=purpose_id,
                        active=active,
                        version=task.version + int(task.active != active),
                    )
                )


def downgrade():
    # Keep directory entries: handoffs or work records may reference them.
    with op.batch_alter_table("team_processing_tasks") as batch:
        batch.drop_constraint("uq_processing_task_purpose", type_="unique")
        batch.drop_constraint("fk_processing_task_purpose", type_="foreignkey")
        batch.drop_column("purpose_id")
