"""Manage warehouse locations and renewable form-selection locks."""

import sqlalchemy as sa
from alembic import op

revision = "20260928_0023"
down_revision = "20260928_0022"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "warehouse_locations" not in sa.inspect(connection).get_table_names():
        op.create_table(
            "warehouse_locations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("reservation_key", sa.String(100), unique=True),
            sa.Column(
                "reserved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")
            ),
            sa.Column("reserved_until", sa.DateTime()),
            sa.Column("reserved_deadline", sa.DateTime()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("team_id", "name", name="uq_warehouse_location_name"),
        )
    # Preserve all existing document snapshots, including older shared slots.
    # Those slots stay unavailable until every historical occupant leaves.
    connection.execute(
        sa.text("""INSERT INTO warehouse_locations
        (team_id, name, active, version, created_at, updated_at)
        SELECT DISTINCT m.next_team_id, m.warehouse_location, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM material_transfers m JOIN teams t ON t.id=m.next_team_id
        WHERE t.code='FACTORY-WAREHOUSE' AND m.warehouse_location IS NOT NULL
          AND trim(m.warehouse_location)<>'' AND NOT EXISTS
          (SELECT 1 FROM warehouse_locations w WHERE w.team_id=m.next_team_id AND w.name=m.warehouse_location)
    """)
    )


def downgrade():
    raise RuntimeError("Keep warehouse locations and locks when rolling back application images")
