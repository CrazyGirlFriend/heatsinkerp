"""Read-only references that keep historical data safe during administration.

Legacy business APIs/workflows are removed. These guards do not expose them;
they only prevent deleting/reclassifying teams still referenced by old rows.
"""

from sqlalchemy import or_, select

from .models import LegacyRecord

# Original foreign-key fields, retained in each archived row's data.
TEAM_REFERENCE_FIELDS = (
    "responsible_team_id",
    "scrap_destination_team_id",
    "operator_team_id",
    "source_team_id",
    "next_team_id",
    "created_by_team_id",
    "destination_team_id",
    "printed_by_team_id",
    "actor_team_id",
)


def team_has_historical_references(db, team_id: int) -> bool:
    return (
        db.scalar(
            select(LegacyRecord.source_id)
            .where(
                or_(
                    *(
                        LegacyRecord.data[field].as_integer() == team_id
                        for field in TEAM_REFERENCE_FIELDS
                    )
                )
            )
            .limit(1)
        )
        is not None
    )
