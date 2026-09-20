"""Allowlisted administrative history, committed with the corresponding mutation."""

from typing import Literal

from sqlalchemy.orm import Session

from .auth import actor_name
from .models import AdminAuditEvent, Team, User
from .observability import request_id


def snapshot(target: Team | User) -> dict:
    fields = (
        ("username", "display_name", "role", "team_id", "active")
        if isinstance(target, User)
        else ("code", "name", "description", "active", "sort_order", "kind")
    )
    return {field: getattr(target, field) for field in fields}


def audit(
    db: Session,
    actor: User,
    target: Team | User,
    action: Literal["created", "updated", "deleted"],
    before: dict | None = None,
    *,
    password_reset: bool = False,
) -> None:
    # Flush assigns IDs and synchronizes relationship-backed team_id. An audit
    # insert failure rolls back the business write with the same transaction.
    db.flush()
    after = None if action == "deleted" else snapshot(target)
    if before == after and not password_reset:
        return
    db.add(
        AdminAuditEvent(
            actor_user_id=actor.id,
            actor=actor_name(actor),
            target_type="user" if isinstance(target, User) else "team",
            target_id=target.id,
            action=action,
            request_id=request_id.get(),
            changes={"before": before, "after": after, "password_reset": password_reset},
        )
    )
