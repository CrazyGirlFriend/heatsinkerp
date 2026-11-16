"""Project team rework requests into quality management without duplicate issues."""

from datetime import timezone

from fastapi import HTTPException
from sqlalchemy import case, exists, literal, select
from sqlalchemy.orm import aliased

from .models import MaterialQuantityAdjustment as Work
from .models import MaterialTransfer as Lot
from .models import ProcessRoute as Route
from .models import ProcessRouteArchive, ProcessRoutePath, Team
from .process_routes import is_engineering_user
from .rework_rounds import current_routes, progress_documents

ProblemTeam = aliased(Team)


def visible(user):
    if (
        user.role == "ADMIN"
        or is_engineering_user(user)
        or (user.role == "TEAM" and user.team and user.team.code == "FACTORY-QC")
    ):
        return True
    return (Route.requesting_team_id == user.team_id) | exists().where(
        ProcessRoutePath.route_id == Route.id, ProcessRoutePath.team_id == user.team_id
    )


def statement(user, team_id=None):
    conditions = [
        *current_routes(),
        Route.rework_inspection_id.is_(None),
        Route.requesting_team_id.is_not(None),
        ~exists().where(ProcessRouteArchive.route_id == Route.id),
        visible(user),
    ]
    if team_id:
        conditions.append(
            (Route.requesting_team_id == team_id)
            | exists().where(
                ProcessRoutePath.route_id == Route.id, ProcessRoutePath.team_id == team_id
            )
        )
    return (
        select(Route, Lot, Team, ProblemTeam)
        .join(Lot, Lot.id == Route.rework_source_transfer_id)
        .join(Team, Team.id == Route.requesting_team_id)
        .outerjoin(Work, Work.id == Route.rework_of_id)
        .outerjoin(ProblemTeam, ProblemTeam.id == Work.team_id)
        .where(*conditions)
    )


def status(route, progress):
    if route.state != "published":
        return "pending"
    return "closed" if progress["state"] == "passed" else "processing"


def document(route, lot, team, progress, problem_team):
    involved = problem_team or team
    return dict(
        id=route.id,
        kind="team_report",
        serial_no=lot.serial_no or "",
        batch_no=lot.batch_no,
        source_transfer_id=lot.id,
        material_name=lot.material_name,
        team_id=team.id,
        team_name=team.name,
        checked_at=route.created_at.replace(tzinfo=timezone.utc).isoformat(),
        notes=route.request_reason or "",
        failed_quantity=lot.quantity,
        weight=float(lot.weight),
        created_by=route.requested_by or route.created_by,
        involved_teams=[dict(team_id=involved.id, name=involved.name, replied=True)],
        feedback_status=status(route, progress),
        disposition="rework",
        route_state=route.state,
        rework_round=route.rework_round,
        rework_progress=progress,
    )


def list_projection(db, user, team_id, fields):
    stmt = statement(user, team_id)
    routes = list(db.scalars(stmt.with_only_columns(Route)))
    progress = progress_documents(db, routes)
    closed = [r.id for r in routes if progress[r.id]["state"] == "passed"]
    values = dict(
        id=Route.id,
        source_transfer_id=Lot.id,
        serial_no=Lot.serial_no,
        material_name=Lot.material_name,
        batch_no=Lot.batch_no,
        team_id=Route.requesting_team_id,
        team_name=Team.name,
        created_at=Route.created_at,
        checked_at=Route.created_at,
        kind=literal("team_report"),
        notes=Route.request_reason,
        failed_quantity=Lot.quantity,
        created_by=Route.requested_by,
        disposition=literal("rework"),
        feedback_status=case(
            (Route.state == "draft", "pending"),
            (Route.id.in_(closed), "closed"),
            else_="processing",
        ),
        route_state=Route.state,
    )
    projected = stmt.with_only_columns(
        *(
            values.get(key, literal(None, type_=column.type)).label(key)
            for key, column in fields.items()
        ),
        maintain_column_froms=True,
    )
    return projected, progress


def detail(db, route_id, user):
    row = db.execute(statement(user).where(Route.id == route_id)).first()
    if row is None:
        raise HTTPException(404, "班组反馈不存在或不属于当前班组")
    route, lot, team, problem_team = row
    return document(route, lot, team, progress_documents(db, [route])[route.id], problem_team)
