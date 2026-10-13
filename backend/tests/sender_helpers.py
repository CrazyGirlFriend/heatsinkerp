"""Supply an explicit sending employee in existing outbound workflow fixtures."""

from app.database import SessionLocal
from app.models import TeamEmployee
from sqlalchemy import select


def sending_employee_id(client, headers):
    account = client.get("/api/auth/me", headers=headers)
    team_id = account.json().get("team_id") if account.status_code == 200 else None
    employee_id = 1  # Permission tests still submit a structurally valid payload.
    if team_id is not None:
        with SessionLocal.begin() as db:
            employee = db.scalar(
                select(TeamEmployee).where(
                    TeamEmployee.team_id == team_id, TeamEmployee.name == "测试转料员"
                )
            )
            if employee is None:
                employee = TeamEmployee(team_id=team_id, name="测试转料员", active=True)
                db.add(employee)
                db.flush()
            employee_id = employee.id
    return employee_id


def sender_post(client, url, **kwargs):
    if "sent_employee_id" not in kwargs.get("json", {}):
        employee_id = sending_employee_id(client, kwargs.get("headers", {}))
        kwargs["json"] = {"sent_employee_id": employee_id, **kwargs.get("json", {})}
    return client.post(url, **kwargs)
