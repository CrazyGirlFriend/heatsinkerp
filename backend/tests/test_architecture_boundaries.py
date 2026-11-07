"""Keep reusable business modules independent of HTTP route assembly."""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def test_business_modules_do_not_import_http_endpoints():
    modules = {path.stem: ast.parse(path.read_text()) for path in sorted(APP.glob("*.py"))}
    routers = {
        name
        for name, tree in modules.items()
        if any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in {"APIRouter", "AsyncAPIRouter"}
            for node in ast.walk(tree)
        )
    }
    violations = []
    for module_name, tree in modules.items():
        # Route modules and application bootstrap may compose HTTP endpoints.
        if module_name == "main" or module_name in routers:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            imports = (
                [node.module]
                if isinstance(node, ast.ImportFrom) and node.module
                else [alias.name for alias in node.names]
            )
            for module in imports:
                name = module.rsplit(".", 1)[-1]
                if name in routers:
                    violations.append(f"{module_name}.py:{node.lineno} imports {module}")
    assert not violations, "Move shared behavior below the API layer:\n" + "\n".join(violations)


def test_processing_rules_do_not_depend_on_http_or_database():
    tree = ast.parse((APP / "processing_rules.py").read_text())
    forbidden = {"fastapi", "sqlalchemy", "database", "models"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert (node.module or "").split(".")[0] not in forbidden
        elif isinstance(node, ast.Import):
            assert all(alias.name.split(".")[0] not in forbidden for alias in node.names)
