from . import models  # noqa: F401
from .database import Base, engine
from .database import SessionLocal
from .auth import ensure_initial_admin


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        ensure_initial_admin(db)


if __name__ == "__main__":
    main()
