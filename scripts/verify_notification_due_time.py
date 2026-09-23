"""MySQL rounding regression; run only after stopping the isolated test application."""

from datetime import datetime
import json
from unittest.mock import patch
from uuid import uuid4

from verify_async_notifications import assert_isolated


def run():
    assert_isolated()
    from app.database import SessionLocal
    from app.models import NotificationOutbox, Team, TeamPurpose
    from app.notification_queue import claim, complete
    from sqlalchemy import select, text

    results = []
    for microsecond in (499999, 500000, 750000, 999999):
        now = datetime(2030, 1, 1, 23, 59, 59, microsecond)
        with SessionLocal() as db:
            before = set(db.scalars(select(NotificationOutbox.id)))
            source = db.scalar(select(Team.id).order_by(Team.id).limit(1))
            rounded = db.scalar(text("SELECT CAST(:value AS DATETIME(0))"), {"value": now})
        with patch("app.inventory_events.utcnow", return_value=now), SessionLocal.begin() as db:
            db.add(TeamPurpose(team_id=source, name="due-time-" + uuid4().hex))
        with SessionLocal() as db:
            created = set(db.scalars(select(NotificationOutbox.id))) - before
            assert len(created) == 1
            message_id = created.pop()
            assert db.get(NotificationOutbox, message_id).available_at == now.replace(microsecond=0)
        claimed = set()
        with patch("app.notification_queue.utcnow", return_value=now), SessionLocal() as db:
            for _ in range(250):
                rows = claim(db, "due-time-probe")
                if not rows:
                    break
                for key, _payload, attempts in rows:
                    claimed.add(key)
                    complete(db, key, "due-time-probe", attempts)
        assert message_id in claimed, "Immediate message was incorrectly scheduled into the future"
        results.append(
            {
                "fraction_us": microsecond,
                "mysql_rounds_forward": rounded > now,
                "immediately_claimable": True,
            }
        )
    print(json.dumps({"mysql_due_time_regression": results, "production_business_writes": 0}))


if __name__ == "__main__":
    run()
