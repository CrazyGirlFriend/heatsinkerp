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
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("team_processing_tasks")}
    purpose_fk = any(
        fk["constrained_columns"] == ["purpose_id"] and fk["referred_table"] == "team_purposes"
        for fk in inspector.get_foreign_keys("team_processing_tasks")
    )
    purpose_unique = any(
        constraint["column_names"] == ["purpose_id"]
        for constraint in inspector.get_unique_constraints("team_processing_tasks")
    )
    with op.batch_alter_table("team_processing_tasks") as batch:
        if "purpose_id" not in columns:
            batch.add_column(sa.Column("purpose_id", sa.Integer(), nullable=True))
        if not purpose_fk:
            batch.create_foreign_key(
                "fk_processing_task_purpose",
                "team_purposes",
                ["purpose_id"],
                ["id"],
                ondelete="RESTRICT",
            )
        if not purpose_unique:
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
    inspector = sa.inspect(op.get_bind())
    purpose_fk = next(
        fk
        for fk in inspector.get_foreign_keys("team_processing_tasks")
        if fk["constrained_columns"] == ["purpose_id"]
    )
    purpose_unique = next(
        constraint
        for constraint in inspector.get_unique_constraints("team_processing_tasks")
        if constraint["column_names"] == ["purpose_id"]
    )
    with op.batch_alter_table(
        "team_processing_tasks",
        naming_convention={
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
        },
    ) as batch:
        batch.drop_constraint(
            purpose_unique["name"] or "uq_team_processing_tasks_purpose_id", type_="unique"
        )
        batch.drop_constraint(
            purpose_fk["name"] or "fk_team_processing_tasks_purpose_id_team_purposes",
            type_="foreignkey",
        )
        batch.drop_column("purpose_id")
