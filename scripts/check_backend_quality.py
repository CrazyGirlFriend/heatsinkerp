"""Check every backend application module and test, including newly added files."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATHS = ("backend/app", "backend/tests", "backend/alembic", "scripts/check_backend_quality.py")

if __name__ == "__main__":
    for command in (("check", *PATHS), ("format", "--check", *PATHS)):
        subprocess.run([sys.executable, "-m", "ruff", *command], cwd=ROOT, check=True)
