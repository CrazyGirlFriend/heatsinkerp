"""Add flat grinding to the grinding team's business directory."""

import sqlalchemy as sa
from alembic import op

revision = "20261105_0068"
down_revision = "20261105_0067"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    connection.execute(
        sa.text("""
        INSERT INTO team_purposes (team_id, name, active, version, updated_at)
        SELECT t.id, '研磨', 1, 1, CURRENT_TIMESTAMP FROM teams t
        WHERE t.code = 'FACTORY-GRIND' AND NOT EXISTS (
            SELECT 1 FROM team_purposes p WHERE p.team_id = t.id
        )
    """)
    )
    connection.execute(
        sa.text("""
        INSERT INTO team_purposes (team_id, name, active, version, updated_at)
        SELECT t.id, '平磨', 1, 1, CURRENT_TIMESTAMP FROM teams t
        WHERE t.code = 'FACTORY-GRIND' AND NOT EXISTS (
            SELECT 1 FROM team_purposes p WHERE p.team_id = t.id AND p.name = '平磨'
        )
    """)
    )


def downgrade():
    # A business choice may already be referenced by received stock; retain it.
    pass
