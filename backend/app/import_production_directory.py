"""Load the reviewed production-sheet roster through audited directory services.

Run with the desired DATABASE_URL and --apply. Without --apply, print additions only.
Existing entries, account credentials, stock and historical production are untouched.
"""

import argparse
import json
from pathlib import Path

from sqlalchemy import select

from .database import SessionLocal
from .models import Team, TeamEmployee, TeamProcessingTask, User
from .team_business import DirectoryItemInput, save_directory_item


def import_directory(db, user, directory, *, apply=False):
    additions = []
    for code, contents in directory.items():
        team = db.scalar(select(Team).where(Team.code == code, Team.active.is_(True)))
        if team is None:
            raise ValueError(f"未找到启用的班组：{code}")
        for kind, model in (("employees", TeamEmployee), ("tasks", TeamProcessingTask)):
            existing = set(db.scalars(select(model.name).where(model.team_id == team.id)))
            for name in contents[kind]:
                if name not in existing:
                    additions.append((team.id, team.name, kind, name))
                    existing.add(name)
    db.commit()  # End this read transaction; SessionLocal preserves the loaded actor.
    if apply:
        for team_id, _, kind, name in additions:
            save_directory_item(
                db,
                team_id,
                user,
                DirectoryItemInput(name=name),
                employee=kind == "employees",
                processing_task=kind == "tasks",
            )
    return [{"team": team, "kind": kind, "name": name} for _, team, kind, name in additions]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    directory = json.loads(
        Path(__file__).with_name("data").joinpath("production_directory_20261112.json").read_text()
    )
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(User.role == "ADMIN", User.active.is_(True)).order_by(User.id)
        )
        if user is None:
            raise ValueError("需要启用的管理员账号记录导入操作")
        changes = import_directory(db, user, directory, apply=args.apply)
    print(json.dumps({"applied": args.apply, "additions": changes}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
