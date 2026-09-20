"""Check all Python for correctness, and the maintained core for style/imports."""

import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FILES = json.loads((ROOT / "scripts/quality-scope.json").read_text())["backend"]


def run(*arguments: str) -> None:
    subprocess.run([sys.executable, "-m", "ruff", *arguments], cwd=ROOT, check=True)


if __name__ == "__main__":
    paths = ["backend/" + path for path in FILES]
    run("check", "backend/app", "backend/tests")
    run("check", "--select", "E4,E7,E9,F,I,B", *paths)
    run("format", "--check", *paths)
