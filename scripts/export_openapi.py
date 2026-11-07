"""Export the application contract without starting services or touching business data."""

import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


def main():
    with TemporaryDirectory(prefix="heatsink-openapi-") as temporary:
        # Importing the app constructs engines, but does not run its lifespan.
        os.environ["DATABASE_URL"] = f"sqlite:///{temporary}/schema.sqlite"
        os.environ["AUTO_CREATE_TABLES"] = "false"
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
        from app.main import app

        print(json.dumps(app.openapi(), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
