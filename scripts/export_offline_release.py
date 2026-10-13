#!/usr/bin/env python3
"""Export the running release and five images without stopping or changing services.

No database, RabbitMQ volume or private configuration is copied. Final data
capture and restore are separate, scheduled operations in server-migration.md.
"""

import argparse
import fcntl
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/opt/heatsinkrep")
SERVICES = ("db", "mq", "backend", "frontend")
EXCLUDED = {".git", ".env", "node_modules", "dist", "output", "__pycache__", ".pytest_cache"}


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def inventory(root):
    release = (root / "current").resolve(strict=True)
    if release.parent != (root / "releases").resolve() or not (root / "current").is_symlink():
        raise RuntimeError("current must point to a release directly under releases")
    result = json.loads((release / "result.json").read_text())
    if result.get("status") != "success":
        raise RuntimeError("The running release has no successful deployment record")
    images = {}
    for service in SERVICES:
        container = json.loads(run(["docker", "inspect", f"heatsinkrep-{service}-1"]))[0]
        labels = container["Config"]["Labels"]
        if (
            labels.get("com.docker.compose.project") != "heatsinkrep"
            or labels.get("com.docker.compose.service") != service
            or not container["State"]["Running"]
            or container["State"].get("Health", {}).get("Status") != "healthy"
        ):
            raise RuntimeError(f"Unexpected or unhealthy container: {service}")
        images[service] = {"id": container["Image"], "reference": container["Config"]["Image"]}
    backup_id = (root / "backup-client-image").read_text().strip()
    images["backup"] = {"id": backup_id, "reference": backup_id}
    for value in images.values():
        info = json.loads(run(["docker", "image", "inspect", value["id"]]))[0]
        value.update(platform=f"{info['Os']}/{info['Architecture']}", bytes=info["Size"])
    if len({v["platform"] for v in images.values()}) != 1:
        raise RuntimeError("Running images have different platforms")
    # Export the exact IDs, not whatever a mutable tag might refer to tomorrow.
    return release, {
        "format": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "release": release.name,
        "revision": result["revision"],
        "images": images,
    }


def source_filter(info):
    path = Path(info.name)
    if (
        not (info.isfile() or info.isdir())
        or any(p in EXCLUDED for p in path.parts)
        or path.name.startswith(".env.")
        and path.name != ".env.example"
        or path.suffix in {".pem", ".key", ".pyc", ".sql", ".db", ".sqlite"}
    ):
        return None
    return info


def export_images(images, target):
    partial = target.with_suffix(".partial")
    with subprocess.Popen(
        ["docker", "image", "save", *sorted({i["id"] for i in images.values()})],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as process:
        try:
            with gzip.open(partial, "wb", compresslevel=1) as output:
                shutil.copyfileobj(process.stdout, output)
        except BaseException:
            process.kill()
            raise
        if process.wait() != 0:
            raise RuntimeError("Docker image export failed; bundle is incomplete")
    # Reading to EOF also verifies gzip CRC/truncation before a success manifest exists.
    with gzip.open(partial, "rb") as source:
        while source.read(1024 * 1024):
            pass
    partial.replace(target)


def write_bundle(root, destination):
    release, manifest = inventory(root)
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    export_images(manifest["images"], destination / "images.tar.gz")
    with tarfile.open(destination / "source.tar.gz", "w:gz") as output:
        for name in (
            "backend",
            "frontend",
            "scripts",
            "docker-compose.server.yml",
            "README.md",
            ".env.example",
        ):
            output.add(release / name, arcname=name, filter=source_filter)
    tools = destination / "migration-tools"
    tools.mkdir()
    source = Path(__file__).resolve().parent
    for name in ("export_offline_release.py", "database_backup.py", "install_database_backup.py"):
        shutil.copyfile(source / name, tools / name)
    shutil.copytree(source / "systemd", tools / "systemd")
    shutil.copyfile(source.parent / "docs" / "server-migration.md", destination / "MIGRATION.md")
    shutil.copyfile(source.parent / "docs" / "database-recovery.md", destination / "RECOVERY.md")
    compose = root / "bin" / "docker-compose"
    if not compose.is_file():
        raise RuntimeError("Install or provide the tested standalone Docker Compose binary first")
    shutil.copyfile(compose, destination / "docker-compose")
    (destination / "docker-compose").chmod(0o700)
    manifest["compose_version"] = run([str(compose), "version", "--short"])
    # JSON is a supported Compose input. Overlay only image identities, never credentials.
    (destination / "compose.offline.json").write_text(
        json.dumps(
            {
                "services": {
                    name: {"image": manifest["images"][name]["id"], "pull_policy": "never"}
                    for name in SERVICES
                }
            },
            indent=2,
        )
        + "\n"
    )
    after, current = inventory(root)
    if after != release or current["images"] != manifest["images"]:
        raise RuntimeError("Running release changed during export; do not use this bundle")
    manifest["files"] = {
        str(p.relative_to(destination)): digest(p)
        for p in sorted(destination.rglob("*"))
        if p.is_file()
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def verify_bundle(path):
    manifest = json.loads((path / "manifest.json").read_text())
    required = {
        "images.tar.gz",
        "source.tar.gz",
        "compose.offline.json",
        "docker-compose",
        "MIGRATION.md",
        "RECOVERY.md",
        "migration-tools/export_offline_release.py",
        "migration-tools/install_database_backup.py",
        "migration-tools/database_backup.py",
    }
    if manifest.get("format") != 1 or not required.issubset(manifest["files"]):
        raise RuntimeError("Incomplete migration bundle")
    if set(manifest["images"]) != {*SERVICES, "backup"}:
        raise RuntimeError("Bundle must contain all five image identities")
    for name, expected in manifest["files"].items():
        file = path / name
        try:
            file.resolve().relative_to(path.resolve())
        except ValueError:
            raise RuntimeError("Unsafe bundle path") from None
        if file.is_symlink() or digest(file) != expected:
            raise RuntimeError(f"Bundle checksum failed: {name}")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--output", type=Path, help="New directory for the offline program bundle")
    group.add_argument(
        "--verify", type=Path, help="Verify every bundle file; no Docker or network calls"
    )
    parser.add_argument("--apply", action="store_true", help="Write bundle; otherwise only inspect")
    args = parser.parse_args()
    if args.verify:
        manifest = verify_bundle(args.verify)
        print(f"Verified: {manifest['release']} ({len(manifest['files'])} files)")
        return
    if not args.apply:
        _, manifest = inventory(ROOT)
        print(json.dumps(manifest, indent=2))
        print("Preview only. Add --apply to export; services stay running.")
        return
    os.umask(0o077)
    with (ROOT / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = write_bundle(ROOT, args.output)
        verify_bundle(args.output)
    print(f"Exported {manifest['release']} to {args.output}. Final data backup is still required.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(f"Offline bundle failed: {reason}; no deployment was performed.")
        raise SystemExit(1) from None
