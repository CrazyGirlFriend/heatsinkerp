"""Initial production-flow schema baseline.

Revision ID: 20260901_0001
Revises:
Create Date: 2026-09-01
"""

from alembic import op
from app import models  # noqa: F401
from app.database import Base
from migration_support.legacy_schema import create_legacy_tables, drop_legacy_tables

revision = "20260901_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())
    # Later historical revisions still upgrade these tables before archiving them.
    create_legacy_tables(op.get_bind())


def downgrade() -> None:
    drop_legacy_tables(op.get_bind())
    Base.metadata.drop_all(bind=op.get_bind())
