"""Supply an explicit roster member to existing receipt workflow regressions."""

from app.database import SessionLocal
from app.models import MaterialDispatch, MaterialTransfer, TeamEmployee
from sqlalchemy import select


def receipt_post(client, url, **kwargs):
    if url.endswith("/confirm"):
        code = url.rsplit("/", 2)[-2]
        model = MaterialDispatch if "/material-dispatches/" in url else MaterialTransfer
        code_column = model.dispatch_no if model is MaterialDispatch else model.batch_no
        with SessionLocal.begin() as db:
            team_id = db.scalar(select(model.next_team_id).where(code_column == code))
            employee_id = None
            if team_id is not None:
                employee = db.scalar(
                    select(TeamEmployee).where(
                        TeamEmployee.team_id == team_id, TeamEmployee.name == "测试收料员"
                    )
                )
                if employee is None:
                    employee = TeamEmployee(team_id=team_id, name="测试收料员", active=True)
                    db.add(employee)
                    db.flush()
                employee_id = employee.id
        kwargs["json"] = {"received_employee_id": employee_id or 1, **kwargs.get("json", {})}
    return client.post(url, **kwargs)
