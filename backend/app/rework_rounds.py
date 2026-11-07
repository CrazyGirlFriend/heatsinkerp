"""Read rework rounds from physical ancestry, with separate work and inspection facts."""

from sqlalchemy import select
from sqlalchemy.orm import aliased

from .material_lineage import relatives
from .models import MaterialInspection as Inspection
from .models import MaterialQuantityAdjustment as Work
from .models import MaterialStockBalance as Balance
from .models import MaterialTransfer as Lot
from .models import ProcessRoute as Route
from .process_routes import is_engineering_user


def current_routes():
    successor = aliased(Route)
    return (
        Route.route_kind == "rework",
        ~((Route.parent_id.is_not(None)) & (Route.state == "draft")),
        ~select(successor.id)
        .where(successor.parent_id == Route.id, successor.state == "published")
        .exists(),
    )


def progress_documents(db, routes):
    routes = {row.id: row for row in routes if row.route_kind == "rework"}
    if not routes:
        return {}
    works = list(
        db.scalars(
            select(Work).where(Work.process_route_id.in_(routes), Work.work_kind == "rework")
        )
    )
    final = [w for w in works if w.process_step_index == len(routes[w.process_route_id].steps) - 1]
    outputs = {
        output["id"]: w for w in final for output in w.outputs or [] if output["role"] == "produced"
    }
    # Follow transfers after the last rework operation. Later processing or a new
    # rework request starts another result and must not rewrite this round.
    tree = (
        select(Lot.id.label("root_id"), Lot.id, Lot.source_transfer_id)
        .where(Lot.id.in_(outputs))
        .cte("rework_finished_stock", recursive=True)
    )
    tree = tree.union(
        select(tree.c.root_id, Lot.id, Lot.source_transfer_id)
        .join(tree, Lot.source_transfer_id == tree.c.id)
        .where(
            Lot.status == "received", Lot.entry_kind.not_in(("rework_split", "processing_output"))
        )
    )
    lots = {lot.id: lot for lot in db.scalars(select(Lot).where(Lot.id.in_(select(tree.c.id))))}
    children = {}
    for lot in lots.values():
        children.setdefault(lot.source_transfer_id, []).append(lot)
    checks, route_checks = {}, {}
    for root_id, check in db.execute(
        select(tree.c.root_id, Inspection)
        .join(Inspection, Inspection.source_transfer_id == tree.c.id)
        .order_by(Inspection.checked_at, Inspection.id)
    ):
        work = outputs[root_id]
        # A backdated pre-rework inspection is not a reinspection.
        if check.checked_at < work.created_at:
            continue
        next_work = [w for w in works if w.source_transfer_id == check.source_transfer_id]
        if any(w.created_at <= check.checked_at for w in next_work):
            continue
        checks.setdefault(check.source_transfer_id, []).append(check)
        route_checks.setdefault(work.process_route_id, []).append(check)

    def coverage(lot, inherited=()):
        available = [*inherited, *checks.get(lot.id, [])]
        latest = max(available, key=lambda c: (c.checked_at, c.id), default=None)
        branches = children.get(lot.id, [])
        remaining = max(0, lot.quantity - sum(child.quantity for child in branches))
        passed = (
            remaining if latest and latest.scope == "full" and not latest.failed_quantity else 0
        )
        failed = bool(remaining and latest and latest.failed_quantity)
        for child in branches:
            # A later check on the remainder cannot cover material already transferred.
            inherited_checks = [c for c in available if c.checked_at <= child.created_at]
            child_passed, child_failed = coverage(child, inherited_checks)
            passed += child_passed
            failed |= child_failed
        return passed, failed

    root_lots = {
        lot.id: lot
        for lot in db.scalars(
            select(Lot).where(Lot.id.in_([r.rework_source_transfer_id for r in routes.values()]))
        )
    }
    unfinished = set()
    for route_id, index, complete in db.execute(
        select(Lot.rework_route_id, Lot.process_step_index, Lot.process_step_complete)
        .join(Balance, Balance.transfer_id == Lot.id)
        .where(Lot.rework_route_id.in_(routes), Balance.on_hand_quantity > 0)
    ):
        if not complete or index != len(routes[route_id].steps) - 1:
            unfinished.add(route_id)
    result = {}
    for route in routes.values():
        quantity = root_lots[route.rework_source_transfer_id].quantity
        completed = sum(w.completed_quantity or 0 for w in final if w.process_route_id == route.id)
        covered, failed = 0, False
        for root_id, work in outputs.items():
            if work.process_route_id == route.id:
                passed, rejected = coverage(lots[root_id])
                covered += passed
                failed |= rejected
        inspections = sorted(
            route_checks.get(route.id, []), key=lambda c: (c.checked_at, c.id), reverse=True
        )
        result[route.id] = {
            "quantity": quantity,
            "completed_quantity": completed,
            "passed_quantity": covered,
            "state": "awaiting_route"
            if route.state != "published"
            else "processing"
            if completed < quantity or route.id in unfinished
            else "failed"
            if failed
            else "passed"
            if covered >= quantity
            else "awaiting_inspection",
            "inspections": [
                {
                    "id": c.id,
                    "batch_no": lots[c.source_transfer_id].batch_no,
                    "scope": c.scope,
                    "sample_quantity": c.sample_quantity,
                    "failed_quantity": c.failed_quantity,
                    "inspector_name": c.inspector_name,
                    "checked_at": c.checked_at.isoformat() + "Z",
                }
                for c in inspections
            ],
        }
    return result


def round_documents(db, route, user):
    ancestors = relatives(
        [route.rework_source_transfer_id], ancestors=True, name="rework_round_ancestors"
    )
    descendants = relatives([route.rework_source_transfer_id], name="rework_round_descendants")
    rows = list(
        db.scalars(
            select(Route)
            .where(
                *current_routes(),
                Route.rework_source_transfer_id.in_(
                    select(ancestors.c.id).union(select(descendants.c.id))
                ),
            )
            .order_by(Route.rework_round, Route.id)
        )
    )
    from .rework_routes import request_documents

    requests = request_documents(db, rows)
    progress = progress_documents(db, rows)
    return [
        {
            "route_id": row.id,
            "state": row.state,
            "engineering_employee_name": row.engineering_employee_name,
            "request": requests[row.id],
            "progress": progress[row.id],
            # Execution teams can see a pending request, never unpublished instructions.
            "steps": row.steps
            if row.state == "published" or user.role == "ADMIN" or is_engineering_user(user)
            else [],
        }
        for row in rows
    ]
