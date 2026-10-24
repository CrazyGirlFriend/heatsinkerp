"""Administrator-maintained order contacts; disabled contacts retain their history."""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from .material_stock import literal_query
from .models import BusinessPerson


def person_dict(person):
    return {key: getattr(person, key) for key in ("id", "name", "active", "version")}


def list_people(db, *, query=None, page=1, page_size=100):
    statement = select(BusinessPerson)
    if query:
        statement = statement.where(literal_query(query, [BusinessPerson.name]))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    return {
        "items": [
            person_dict(person)
            for person in db.scalars(
                statement.order_by(
                    BusinessPerson.active.desc(), BusinessPerson.name, BusinessPerson.id
                )
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def require_assignable(db, person_id, current_id=None):
    if person_id is None:
        return
    person = db.get(BusinessPerson, person_id)
    if person is None or (not person.active and person_id != current_id):
        raise HTTPException(422, "请选择启用的业务人员")


def save_person(db, payload, person_id=None):
    try:
        with db.begin():
            if person_id:
                person = db.scalar(
                    select(BusinessPerson).where(BusinessPerson.id == person_id).with_for_update()
                )
                if person is None:
                    raise HTTPException(404, "业务人员不存在")
                if person.version != payload.expected_version:
                    raise HTTPException(409, "业务人员资料已修改，请刷新后重试")
                person.name, person.active = payload.name, payload.active
                person.version += 1
            else:
                person = BusinessPerson(name=payload.name, active=payload.active)
                db.add(person)
            db.flush()
            result = person_dict(person)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "业务人员姓名已存在") from None
    return result
