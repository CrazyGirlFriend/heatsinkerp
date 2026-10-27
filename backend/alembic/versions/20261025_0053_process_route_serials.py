"""Reserve one primary serial per normal-route family without deleting old duplicates."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import VARCHAR

revision = "20261025_0053"
down_revision = "20261024_0052"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if not sa.inspect(connection).has_table("process_route_serials"):
        op.create_table(
            "process_route_serials",
            sa.Column(
                "serial_no",
                sa.String(240).with_variant(VARCHAR(240, collation="utf8mb4_bin"), "mysql"),
                primary_key=True,
            ),
            sa.Column(
                "route_id",
                sa.Integer(),
                sa.ForeignKey("process_routes.id", ondelete="RESTRICT"),
                nullable=True,
            ),
        )
        op.create_index("ix_process_route_serials_route_id", "process_route_serials", ["route_id"])
    registry = sa.table(
        "process_route_serials",
        sa.column("serial_no", sa.String(240)),
        sa.column("route_id", sa.Integer()),
    )
    routes = sa.table(
        "process_routes",
        sa.column("id", sa.Integer()),
        sa.column("parent_id", sa.Integer()),
        sa.column("route_kind", sa.String(16)),
        sa.column("serial_nos", sa.JSON()),
    )
    families = (
        sa.select(routes.c.id, routes.c.id.label("root_id"), routes.c.serial_nos)
        .where(routes.c.parent_id.is_(None), routes.c.route_kind == "normal")
        .cte("normal_route_families", recursive=True)
    )
    families = families.union_all(
        sa.select(routes.c.id, families.c.root_id, routes.c.serial_nos)
        .join(families, routes.c.parent_id == families.c.id)
        .where(routes.c.route_kind == "normal")
    )
    owners = dict(connection.execute(sa.select(registry)).all())
    original = owners.copy()
    for root_id, serials in connection.execute(
        sa.select(families.c.root_id, families.c.serial_nos)
    ):
        if not serials or not isinstance(serials[0], str) or not serials[0].strip():
            continue
        key = serials[0].strip().casefold()
        if key not in owners:
            owners[key] = root_id
        elif owners[key] != root_id:
            owners[key] = None
    new = [
        dict(serial_no=key, route_id=owner) for key, owner in owners.items() if key not in original
    ]
    for start in range(0, len(new), 1000):
        connection.execute(registry.insert(), new[start : start + 1000])
    for key, owner in owners.items():
        if key in original and owner != original[key]:
            connection.execute(
                registry.update().where(registry.c.serial_no == key).values(route_id=owner)
            )


def downgrade():
    op.drop_index("ix_process_route_serials_route_id", table_name="process_route_serials")
    op.drop_table("process_route_serials")
