from . import models  # noqa: F401
from .auth import ensure_initial_admin
from .database import Base, SessionLocal, engine


def main() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        ensure_initial_admin(db)


if __name__ == "__main__":
    main()
