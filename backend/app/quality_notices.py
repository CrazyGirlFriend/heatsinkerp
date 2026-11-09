"""Quality issues notify only the teams explicitly selected by QC."""

from sqlalchemy import select

from .models import InspectionFeedbackTeam, QualityNotice, utcnow
from .schedule_notices import insert_once


def notify_involved_teams(db, issue):
    problems = "、".join(problem.name for problem in issue.problems)
    message = f"不合格 {issue.failed_quantity} 件"
    if problems:
        message += f" · {problems}"
    for team_id in db.scalars(
        select(InspectionFeedbackTeam.team_id).where(
            InspectionFeedbackTeam.inspection_id == issue.id
        )
    ):
        insert_once(
            db,
            QualityNotice,
            dict(
                event_key=f"quality:{issue.id}:team:{team_id}",
                inspection_id=issue.id,
                team_id=team_id,
                kind="quality_reported",
                message=message[:300],
                created_at=utcnow(),
            ),
            "event_key",
        )
