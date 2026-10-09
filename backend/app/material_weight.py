"""Sludge retains its measured mass; the shared weight ledger holds material mass."""
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from fastapi import HTTPException

SLUDGE_FIELDS = ("sludge_gross_weight", "sludge_content_percent")
WEIGHT_ONLY_TYPES = ("sludge", "scrap_chips")
MATERIAL_WEIGHT_TOLERANCE = Decimal("1")  # Allowed cumulative difference per source batch, kg.


def validate_material_amounts(material_type, quantity, weight, *, existing=None):
    if material_type not in WEIGHT_ONLY_TYPES:
        return
    # Existing counts remain auditable; edits cannot introduce or increase them.
    legacy_count = existing is not None and material_type == existing.material_type and quantity == existing.quantity
    if quantity != 0 and not legacy_count:
        raise HTTPException(422, "废泥、废屑只按重量计量，件数须为 0")
    if weight <= 0 and not (legacy_count and weight == existing.weight):
        raise HTTPException(422, "废泥、废屑的重量须大于 0")


def sludge_measurement(material_type, weight, gross, percent, *, source=None, legacy=False, existing=None):
    if existing is not None and material_type == existing.material_type == "sludge" and (weight, gross, percent) == (existing.weight, existing.sludge_gross_weight, existing.sludge_content_percent):
        return dict(zip(SLUDGE_FIELDS, (gross, percent)))
    if source is not None and source.material_type == "sludge":
        if material_type != "sludge":
            raise HTTPException(422, "废泥转料须保留原物料类型和有效材料占比")
        if source.sludge_content_percent is None:
            if gross is not None or percent is not None:
                raise HTTPException(422, "历史废泥未记录比例，不能在再次转出时重新折算原库存")
            legacy = True
        elif percent != source.sludge_content_percent:
            raise HTTPException(422, "再次转出废泥须沿用来源批次的有效材料占比")
    if material_type != "sludge":
        if gross is not None or percent is not None:
            raise HTTPException(422, "只有废泥可以填写实重和有效材料占比")
    elif legacy and gross is None and percent is None:
        pass  # Never invent a percentage or revalue pre-upgrade stock.
    else:
        if gross is None or percent is None:
            raise HTTPException(422, "请填写废泥实重和有效材料占比")
        if gross <= 0 or not 0 < percent <= 100:
            raise HTTPException(422, "废泥实重须大于零，有效材料占比须大于 0% 且不超过 100%")
        calculated = (gross * percent / Decimal(100)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        if calculated <= 0:
            raise HTTPException(422, "折算重量不足 0.000001 kg，请核对废泥实重和比例")
        if weight != calculated:
            raise HTTPException(422, f"废泥折算重量应为 {calculated} kg，请核对实重和比例")
    return dict(zip(SLUDGE_FIELDS, (gross, percent)))


def remaining_sludge_gross(gross, percent, transferred, lost_weight):
    # Losses are entered in accounted kg. Never reconstruct the original gross
    # from rounded accounted kg: e.g. 1.005 kg at 10% is recorded as 0.101 kg.
    return (gross - transferred - lost_weight * 100 / percent).quantize(Decimal(".000001"), rounding=ROUND_DOWN)


def stock_sludge_measurements(db, items):
    """One aggregate for measured sludge in this page; no extra work for normal lots."""
    from sqlalchemy import func, select
    from .models import MaterialTransfer
    measured = [item for item in items if item["transfer"]["sludge_content_percent"] is not None]
    if measured:
        transferred = dict(db.execute(select(MaterialTransfer.source_transfer_id, func.sum(MaterialTransfer.sludge_gross_weight)).where(
            MaterialTransfer.source_transfer_id.in_([item["transfer"]["id"] for item in measured]),
            MaterialTransfer.status.in_(["pending", "received", "dispatched"])
        ).group_by(MaterialTransfer.source_transfer_id)).all())
        for item in measured:
            lot = item["transfer"]
            item["sludge_available_gross_weight"] = float(remaining_sludge_gross(
                Decimal(str(lot["sludge_gross_weight"])), Decimal(str(lot["sludge_content_percent"])),
                transferred.get(lot["id"]) or Decimal(0), Decimal(str(item["lost_weight"]))))
    return items
