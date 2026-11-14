"""One paginated index for warehouse slots and unassigned physical stock."""

from sqlalchemy import case, func, literal, or_, select, union_all

from . import warehouse_locations as locations
from .material_stock import literal_query
from .material_stock_queries import list_stock, stock_table
from .models import MaterialTransfer as Transfer
from .models import WarehouseLocation as Location
from .models import WarehousePlacement as Placement
from .models import utcnow
from .table_query import current_table_query, query_statement
from .warehouse_placements import allocation_table, unassigned_predicate


def list_catalog(db, user, *, query=None, state=None, team_id=None, page=1, page_size=20):
    locations.require_manager(user)
    team = locations.warehouse(db, team_id)
    contents = (
        select(
            Placement.location_id,
            func.group_concat(Transfer.serial_no).label("serial_no"),
            func.group_concat(Transfer.material_name).label("material_name"),
            func.group_concat(Transfer.batch_no).label("batch_no"),
            func.sum(case((Transfer.status == "received", Placement.quantity), else_=0)).label(
                "quantity"
            ),
            func.sum(case((Transfer.status == "received", Placement.weight), else_=0)).label(
                "weight"
            ),
            func.sum(case((Transfer.status == "received", 1), else_=0)).label("received"),
            func.sum(case((Transfer.status == "pending", 1), else_=0)).label("pending"),
        )
        .join(Transfer, Transfer.id == Placement.transfer_id)
        .where(or_(Placement.quantity > 0, Placement.weight > 0))
        .group_by(Placement.location_id)
        .subquery()
    )
    draft = (Location.reservation_key.is_not(None)) & (Location.reserved_until > utcnow())
    status = case(
        (Location.active.is_(False), "disabled"),
        (draft, "draft"),
        (func.coalesce(contents.c.received, 0) > 0, "occupied"),
        (func.coalesce(contents.c.pending, 0) > 0, "pending"),
        else_="available",
    )
    slots = (
        select(
            literal("location").label("kind"),
            Location.id,
            Location.name,
            contents.c.serial_no,
            contents.c.material_name,
            contents.c.batch_no,
            Location.created_at,
            Location.active,
            func.coalesce(draft, False).label("draft_locked"),
            func.coalesce(contents.c.quantity, 0).label("quantity"),
            func.coalesce(contents.c.weight, 0).label("weight"),
            func.coalesce(contents.c.received, 0).label("received"),
            func.coalesce(contents.c.pending, 0).label("pending"),
            status.label("status"),
        )
        .outerjoin(contents, contents.c.location_id == Location.id)
        .where(Location.team_id == team.id)
    )
    stock = stock_table(team.id)
    allocated = allocation_table()
    amounts = {
        unit: stock.c[f"on_hand_{unit}"]
        + stock.c[f"external_pending_{unit}"]
        - func.coalesce(allocated.c[unit], 0)
        for unit in ("quantity", "weight")
    }
    unassigned = (
        select(
            literal("stock").label("kind"),
            stock.c.transfer_id.label("id"),
            literal(None).label("name"),
            stock.c.serial_no,
            stock.c.material_name,
            stock.c.batch_no,
            Transfer.created_at,
            literal(True).label("active"),
            literal(False).label("draft_locked"),
            *(case((amount > 0, amount), else_=0).label(unit) for unit, amount in amounts.items()),
            literal(1).label("received"),
            literal(0).label("pending"),
            literal("unassigned").label("status"),
        )
        .join(Transfer, Transfer.id == stock.c.transfer_id)
        .outerjoin(allocated, allocated.c.transfer_id == stock.c.transfer_id)
        .where(unassigned_predicate(stock))
    )
    index = union_all(slots, unassigned).subquery()
    statement = select(index)
    if state:
        statement = statement.where(
            {
                "occupied": (index.c.kind == "location") & (index.c.received > 0),
                "pending": (index.c.kind == "location") & (index.c.pending > 0),
                "draft": index.c.draft_locked.is_(True),
                "disabled": index.c.active.is_(False),
                "available": index.c.status == "available",
                "unassigned": index.c.kind == "stock",
            }[state]
        )
    if query and query.strip():
        statement = statement.where(
            literal_query(
                query, [index.c.name, index.c.serial_no, index.c.material_name, index.c.batch_no]
            )
        )
    statement = query_statement(
        statement,
        index.c.created_at.desc(),
        index.c.id.desc(),
        index.c.kind,
        columns={
            **dict(index.c.items()),
            "assignment": case(
                (index.c.kind == "stock", "unassigned"),
                (index.c.received + index.c.pending > 0, "assigned"),
                else_="empty",
            ),
        },
    )
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    rows = db.execute(statement.offset((page - 1) * page_size).limit(page_size)).mappings().all()
    slot_ids = [row["id"] for row in rows if row["kind"] == "location"]
    stock_ids = [row["id"] for row in rows if row["kind"] == "stock"]
    occupants = locations.occupants(db, slot_ids) if slot_ids else []
    slot_values = {
        slot.id: locations.location_dict(
            slot, [item for item in occupants if item["location_id"] == slot.id]
        )
        for slot in db.scalars(select(Location).where(Location.id.in_(slot_ids)))
    }
    # Index predicates have already selected the page; don't reapply them to lot hydration.
    token = current_table_query.set(None)
    try:
        batches = (
            list_stock(
                db, team.id, user, source_ids=stock_ids, availability="all", page_size=page_size
            )["items"]
            if stock_ids
            else []
        )
    finally:
        current_table_query.reset(token)
    stock_values = {item["transfer"]["id"]: item for item in batches}
    return {
        "items": [
            {
                "key": f"{row['kind']}-{row['id']}",
                "location": slot_values.get(row["id"]) if row["kind"] == "location" else None,
                "stock": stock_values.get(row["id"]) if row["kind"] == "stock" else None,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
