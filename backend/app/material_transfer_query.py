"""Explicit search semantics shared by list filters and query-plan verification."""

from sqlalchemy import or_

from .models import MaterialTransfer


INDEXED_SEARCH_FIELDS = {
    name: getattr(MaterialTransfer, name)
    for name in (
        "batch_no", "serial_no", "source_batch_no", "product_code",
        "customer_code", "material_name",
    )
}
CONTAINS_SEARCH_FIELDS = (
    *INDEXED_SEARCH_FIELDS.values(),
    MaterialTransfer.source_team_code,
    MaterialTransfer.source_team_name,
    MaterialTransfer.next_team_code,
    MaterialTransfer.next_team_name,
    MaterialTransfer.created_by,
)


def team_scope_predicate(team_id: int, direction: str = "all"):
    if direction == "outgoing":
        return MaterialTransfer.source_team_id == team_id
    if direction == "incoming":
        return MaterialTransfer.next_team_id == team_id
    if direction != "all":
        raise ValueError("unknown material transfer direction")
    return or_(MaterialTransfer.source_team_id == team_id, MaterialTransfer.next_team_id == team_id)


def search_predicate(query: str, search_field: str = "all", search_mode: str = "contains"):
    """Never infer a mode or silently narrow an existing contains search."""
    if search_field == "all":
        fields = CONTAINS_SEARCH_FIELDS if search_mode == "contains" else tuple(INDEXED_SEARCH_FIELDS.values())
    else:
        fields = (INDEXED_SEARCH_FIELDS[search_field],)
    term = query.strip()
    if search_mode == "exact":
        return or_(*(field == term for field in fields))
    # Treat user-supplied SQL wildcards literally, including the escape itself.
    escaped = term.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    pattern = f"{escaped}%" if search_mode == "prefix" else f"%{escaped}%"
    return or_(*(field.like(pattern, escape="!") for field in fields))
