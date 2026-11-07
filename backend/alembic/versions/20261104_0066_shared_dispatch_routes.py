"""Keep each joint production order's execution route after cutting."""

import sqlalchemy as sa
from alembic import op

revision = "20261104_0066"
down_revision = "20261103_0065"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    # The initial baseline creates current ORM metadata on an empty database.
    if "split_step_index" not in {
        column["name"] for column in inspector.get_columns("shared_material_groups")
    }:
        op.add_column("shared_material_groups", sa.Column("split_step_index", sa.Integer()))
    columns = {column["name"] for column in inspector.get_columns("shared_material_members")}
    route_fk = any(
        fk["constrained_columns"] == ["process_route_id"]
        and fk["referred_table"] == "process_routes"
        for fk in inspector.get_foreign_keys("shared_material_members")
    )
    with op.batch_alter_table("shared_material_members") as batch:
        if "process_route_id" not in columns:
            batch.add_column(sa.Column("process_route_id", sa.Integer()))
        if "process_route_version" not in columns:
            batch.add_column(sa.Column("process_route_version", sa.Integer()))
        if not route_fk:
            batch.create_foreign_key(
                "fk_shared_member_route",
                "process_routes",
                ["process_route_id"],
                ["id"],
                ondelete="RESTRICT",
            )


def downgrade():
    route_fk = next(
        fk
        for fk in sa.inspect(op.get_bind()).get_foreign_keys("shared_material_members")
        if fk["constrained_columns"] == ["process_route_id"]
    )
    with op.batch_alter_table(
        "shared_material_members",
        naming_convention={"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"},
    ) as batch:
        batch.drop_constraint(
            route_fk["name"] or "fk_shared_material_members_process_route_id_process_routes",
            type_="foreignkey",
        )
        batch.drop_column("process_route_version")
        batch.drop_column("process_route_id")
    op.drop_column("shared_material_groups", "split_step_index")
