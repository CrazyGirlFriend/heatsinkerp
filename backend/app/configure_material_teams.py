"""Idempotent configuration of the eight confirmed phase-one material teams.

Legacy demo/shipping/scrap teams and all account and transfer references remain
untouched. Only the explicitly requested 扎板 -> 轧制 directory rename is applied.
"""
from __future__ import annotations

import json
from sqlalchemy import or_, select

from .database import SessionLocal
from .models import Team


MATERIAL_TEAMS = (
    ("FACTORY-WAREHOUSE", "库房", "warehouse", "物料收发及转废接收"),
    ("FACTORY-ROLL", "轧制", "production", None),
    ("FACTORY-ANNEAL", "退火", "production", None),
    ("FACTORY-GRIND", "研磨", "production", None),
    ("FACTORY-WIRE", "线切割", "production", None),
    ("FACTORY-ENGRAVE", "雕刻", "production", None),
    ("FACTORY-PLATE", "电镀", "production", None),
    ("FACTORY-QC", "检验", "production", "包含去毛刺、检验及发货业务"),
)


def configure_material_teams(db):
    inserted, renamed, kept = [], [], []
    with db.begin():
        for order, (code, name, kind, description) in enumerate(MATERIAL_TEAMS):
            existing = db.scalars(select(Team).where(or_(Team.code == code, Team.name == name))).all()
            if not existing:
                db.add(Team(code=code, name=name, kind=kind, description=description,
                            active=True, sort_order=5 if order == 0 else order * 10))
                inserted.append(name)
                continue
            if len(existing) != 1 or existing[0].code != code or existing[0].kind != kind:
                raise RuntimeError(f"正式班组编码/名称/类型冲突：{name}；未覆盖已有数据")
            team = existing[0]
            if code == "FACTORY-ROLL" and team.name == "扎板":
                team.name = name
                renamed.append({"id": team.id, "before": "扎板", "after": name})
            elif team.name != name:
                raise RuntimeError(f"正式班组名称不一致：{code}；请人工核对，没有覆盖自定义名称")
            else:
                kept.append(name)
        db.flush()
    return {"inserted": inserted, "renamed": renamed, "kept": kept}


def main():
    with SessionLocal() as db:
        print(json.dumps(configure_material_teams(db), ensure_ascii=False))


if __name__ == "__main__":
    main()
