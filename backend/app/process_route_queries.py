"""Process-route catalogue reads and imported step-to-team lookup."""

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import aliased

from .models import (
    InspectionFeedbackTeam,
    InspectionProblem,
    MaterialTransfer,
    ProcessRoute,
    ProcessRouteArchive,
    ProcessRouteDrawing,
    ProcessRoutePath,
    ProcessRoutePolicy,
    Team,
)
from .process_route_documents import document, drawing_document
from .process_routes import is_engineering_user, missing_route_documents
from .rework_routes import request_documents
from .team_constants import WAREHOUSE_TEAM_CODE


def list_routes(
    db,
    user,
    *,
    kind="normal",
    rework_scope="all",
    state=None,
    query="",
    page=1,
    page_size=20,
    sort_order="desc",
):
    from .material_stock import literal_query

    where = (
        [
            or_(
                literal_query(
                    query.strip(),
                    [
                        cast(ProcessRoute.serial_nos, String),
                        ProcessRoute.engineering_employee_name,
                        ProcessRoute.modified_employee_name,
                        ProcessRoute.title,
                        ProcessRoute.request_reason,
                        ProcessRoute.requesting_team_name,
                    ],
                ),
                select(MaterialTransfer.id)
                .where(
                    MaterialTransfer.id == ProcessRoute.rework_source_transfer_id,
                    literal_query(
                        query.strip(), [MaterialTransfer.batch_no, MaterialTransfer.next_team_name]
                    ),
                )
                .exists(),
                select(InspectionProblem.inspection_id)
                .where(
                    InspectionProblem.inspection_id == ProcessRoute.rework_inspection_id,
                    literal_query(query.strip(), [InspectionProblem.name]),
                )
                .exists(),
                select(InspectionFeedbackTeam.inspection_id)
                .join(Team, Team.id == InspectionFeedbackTeam.team_id)
                .where(
                    InspectionFeedbackTeam.inspection_id == ProcessRoute.rework_inspection_id,
                    literal_query(query.strip(), [Team.name]),
                )
                .exists(),
                select(ProcessRoutePath.route_id)
                .join(Team, Team.id == ProcessRoutePath.team_id)
                .where(
                    ProcessRoutePath.route_id == ProcessRoute.id,
                    literal_query(query.strip(), [Team.name]),
                )
                .exists(),
            )
        ]
        if query.strip()
        else []
    )
    if kind != "all":
        where.append(ProcessRoute.route_kind == kind)
    if user.role != "ADMIN" and not is_engineering_user(user):
        where.append(ProcessRoute.state == "published")
    if state:
        where.append(ProcessRoute.state == state)
    successor = aliased(ProcessRoute)
    archived = (
        select(ProcessRouteArchive.route_id)
        .where(ProcessRouteArchive.route_id == ProcessRoute.id)
        .exists()
    )
    superseded = (
        select(successor.id)
        .where(successor.parent_id == ProcessRoute.id, successor.state == "published")
        .exists()
    )
    current = [
        ~archived,
        ~((ProcessRoute.parent_id.is_not(None)) & (ProcessRoute.state == "draft")),
        ~superseded,
    ]
    where.extend(current)
    from .rework_rounds import progress_documents

    progress = None
    if kind == "rework" and rework_scope != "all":
        progress = progress_documents(db, db.scalars(select(ProcessRoute).where(*where)))
        where.append(
            ProcessRoute.id.in_(
                [
                    route_id
                    for route_id, value in progress.items()
                    if (value["state"] in ("passed", "failed")) == (rework_scope == "ended")
                ]
            )
        )
    from .table_query import table_order, table_predicates

    material_name = ProcessRoute.source_data["receipt_fields"]["material_name"]["value"].as_string()
    columns = {**dict(ProcessRoute.__table__.columns.items()), "material_name": material_name}
    where.extend(table_predicates(columns))
    effective_time = ProcessRoute.created_at
    ordering = (
        (effective_time.asc(), ProcessRoute.id.asc())
        if sort_order == "asc"
        else (effective_time.desc(), ProcessRoute.id.desc())
    )
    result = db.execute(
        select(
            ProcessRoute,
            ProcessRoute.source_data["receipt_fields"]["material_name"]["value"]
            .as_string()
            .label("material_name"),
        )
        .where(*where)
        .order_by(*table_order(columns, *ordering))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    rows = [row for row, _ in result]
    if progress is None:
        progress = progress_documents(db, rows)
    materials = {row.id: material for row, material in result}
    drawings = {row.id: [] for row in rows}
    for drawing in db.scalars(
        select(ProcessRouteDrawing)
        .where(ProcessRouteDrawing.route_id.in_(drawings))
        .order_by(ProcessRouteDrawing.id)
    ):
        drawings[drawing.route_id].append(drawing_document(drawing))
    requests = request_documents(db, rows)
    missing = missing_route_documents(db, [row.id for row in rows])
    items = []
    for row in rows:
        item = document(row, detail=False, missing_documents=missing.get(row.id, []))
        item.update(
            material_name=materials[row.id] or "",
            step_summary=[
                {
                    "sequence_no": step["sequence_no"],
                    "name": step["name"],
                    "team_id": step.get("team_id"),
                }
                for step in row.steps
            ],
            drawings=drawings[row.id],
        )
        scope = requests.get(row.id)
        if scope:
            item.update(
                rework_request=scope,
                rework_batch_no=scope["batch_no"],
                rework_quantity=scope["quantity"],
                rework_weight=scope["weight"],
                rework_progress=progress[row.id],
            )
        items.append(item)
    policy = db.get(ProcessRoutePolicy, 1)
    return {
        "items": items,
        "total": db.scalar(select(func.count()).select_from(ProcessRoute).where(*where)),
        "page": page,
        "page_size": page_size,
        "pending_rework_count": (
            db.scalar(
                select(func.count())
                .select_from(ProcessRoute)
                .where(*current, ProcessRoute.route_kind == "rework", ProcessRoute.state == "draft")
            )
            if user.role == "ADMIN" or is_engineering_user(user)
            else 0
        ),
        "enforced_after": policy.enforced_after.isoformat() + "Z" if policy else None,
    }


def map_word_steps(session, steps):
    aliases = {
        "中转库": WAREHOUSE_TEAM_CODE,
        "库房": WAREHOUSE_TEAM_CODE,
        "轧板": "FACTORY-ROLL",
        "轧制": "FACTORY-ROLL",
        "线切割": "FACTORY-WIRE",
        "退火": "FACTORY-ANNEAL",
        "研磨": "FACTORY-GRIND",
        "雕刻": "FACTORY-ENGRAVE",
        "电镀": "FACTORY-PLATE",
        "质检": "FACTORY-QC",
        "检验": "FACTORY-QC",
    }
    teams = session.scalars(
        select(Team).where(Team.active.is_(True), Team.kind.in_(("warehouse", "production")))
    ).all()
    for step in steps:
        if step.get("team_id") is not None:
            continue
        name = step["name"].strip()
        code = aliases.get(name)
        matches = [team for team in teams if (team.code == code if code else team.name == name)]
        if len(matches) == 1:
            step.update(team_id=matches[0].id, team_name=matches[0].name)
