"""Single-host MySQL recovery preparation. Never restores or changes business rows.

Run as root on the application host. Full backups share the deployment lock.
The stream uses a dedicated replication-only account in a private client file.
"""

import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

ROOT = Path("/opt/heatsinkrep")
STORE = ROOT / "backups" / "continuous"
DB = "heatsinkrep-db-1"
CLIENT = ROOT / "backup-client.cnf"
BINLOG = re.compile(r"binlog\.\d{6,}")
COORDINATES = re.compile(r"SOURCE_LOG_FILE='(binlog\.\d+)', SOURCE_LOG_POS=(\d+)")


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def sql(query):
    return run(
        [
            "docker",
            "exec",
            "-i",
            DB,
            "sh",
            "-c",
            'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot --batch --skip-column-names',
        ],
        input=query,
        text=True,
        capture_output=True,
    ).stdout.strip()


def atomic_json(path, value):
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w") as output:
        json.dump(value, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)
    sync_directory(path.parent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def inspect_dump(path):
    position = None
    completed = False
    with gzip.open(path, "rt") as source:
        for line in source:
            match = COORDINATES.search(line)
            if match:
                position = {"file": match[1], "position": int(match[2])}
            completed = completed or line.startswith("-- Dump completed on ")
    if not position or not completed:
        raise RuntimeError("Incomplete dump or missing binlog coordinates")
    return position


@contextmanager
def deployment_lock():
    with (ROOT / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def snapshots():
    return sorted(path for path in STORE.glob("full-*") if (path / "manifest.json").is_file())


def prune():
    copies = snapshots()
    # Only our own successful backups; deployment/manual backups are untouched.
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    newer = [
        path
        for path in copies
        if datetime.fromisoformat(json.loads((path / "manifest.json").read_text())["created_at"])
        >= cutoff
    ]
    older = [path for path in copies if path not in newer]
    retained = older[-1:] + newer
    if not retained:
        return
    for path in retained:
        manifest = json.loads((path / "manifest.json").read_text())
        if digest(path / "database.sql.gz") != manifest["sha256"]:
            raise RuntimeError("Backup checksum failed; retention stopped")
    oldest = json.loads((retained[0] / "manifest.json").read_text())["binlog"]["file"]
    for path in copies:
        if path not in retained:
            shutil.rmtree(path)
    for path in (STORE / "binlogs").glob("binlog.*"):
        if BINLOG.fullmatch(path.name) and path.name < oldest:
            path.unlink()


def full():
    with deployment_lock():
        existing = snapshots()
        server_uuid = sql("SELECT @@server_uuid")
        if (
            existing
            and json.loads((existing[-1] / "manifest.json").read_text())["server_uuid"]
            != server_uuid
        ):
            raise RuntimeError(
                "Database identity changed; preserve the old recovery chain separately"
            )
        if shutil.disk_usage(STORE).free < 10 * 1024**3:
            raise RuntimeError("Less than 10 GiB free; full backup refused")
        engines = sql(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='heatsink_rep' AND table_type='BASE TABLE' AND engine <> 'InnoDB'"
        )
        if engines != "0":
            raise RuntimeError("Online backup requires all business tables to be InnoDB")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        staging = STORE / ("pending-" + stamp)
        staging.mkdir(mode=0o700)
        target = staging / "database.sql.gz"
        # Incomplete staging directories remain private and are never published.
        command = [
            "docker",
            "exec",
            DB,
            "sh",
            "-c",
            'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump -uroot '
            "--single-transaction --source-data=2 --set-gtid-purged=OFF "
            "--routines --events --triggers --hex-blob --no-tablespaces "
            '--databases "$MYSQL_DATABASE"',
        ]
        with (staging / "dump.log").open("wb") as errors:
            with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors) as process:
                try:
                    with gzip.open(target, "wb", compresslevel=6) as output:
                        shutil.copyfileobj(process.stdout, output, 1024 * 1024)
                except BaseException:
                    process.kill()
                    raise
                if process.wait():
                    raise RuntimeError("mysqldump failed; see private dump.log")
        coordinates = inspect_dump(target)
        shutil.copyfile(ROOT / ".env", staging / "config.env")
        for path in (target, staging / "config.env"):
            with path.open("rb") as source:
                os.fsync(source.fileno())
        atomic_json(
            staging / "manifest.json",
            {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "binlog": coordinates,
                "sha256": digest(target),
                "config_sha256": digest(staging / "config.env"),
                "database": "heatsink_rep",
                "server_uuid": server_uuid,
                "release": (ROOT / "current").resolve().name,
            },
        )
        staging.rename(STORE / ("full-" + stamp))
        sync_directory(STORE)
        prune()
        print(json.dumps({"backup": "full-" + stamp, "binlog": coordinates}))


def stream():
    available = [line.split()[0] for line in sql("SHOW BINARY LOGS").splitlines()]
    archived = sorted(
        path.name for path in (STORE / "binlogs").glob("binlog.*") if BINLOG.fullmatch(path.name)
    )
    if not snapshots():
        raise RuntimeError("Create a full backup before starting the log stream")
    manifest = json.loads((snapshots()[-1] / "manifest.json").read_text())
    if manifest["server_uuid"] != sql("SELECT @@server_uuid"):
        raise RuntimeError("Database identity changed; refuse to overwrite archived logs")
    earliest = json.loads((snapshots()[0] / "manifest.json").read_text())["binlog"]["file"]
    first = archived[-1] if archived else earliest
    if first not in available:
        raise RuntimeError("Source log was purged; recovery chain requires a new full backup")
    image = (ROOT / "backup-client-image").read_text().strip()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise RuntimeError("Invalid backup client image identity")
    # Re-read the last file from byte 4 after reconnect, replacing a partial tail.
    os.execvp(
        "docker",
        [
            "docker",
            "run",
            "--rm",
            "--name",
            "heatsinkrep-binlog-backup",
            "--network",
            "heatsinkrep_default",
            "--memory",
            "128m",
            "--cpus",
            "0.25",
            "--log-opt",
            "max-size=5m",
            "--log-opt",
            "max-file=2",
            "-v",
            f"{CLIENT}:/client.cnf:ro",
            "-v",
            f"{STORE / 'binlogs'}:/archive",
            "--entrypoint",
            "mysqlbinlog",
            image,
            "--defaults-extra-file=/client.cnf",
            "--read-from-remote-server",
            "--raw",
            "--stop-never",
            "--connection-server-id=420120",
            "--result-file=/archive/",
            first,
        ],
    )


def check():
    issues = []
    running = subprocess.run(
        ["docker", "inspect", "heatsinkrep-binlog-backup", "--format", "{{.State.Running}}"],
        capture_output=True,
        text=True,
    )
    if running.returncode or running.stdout.strip() != "true":
        issues.append("continuous archive container is not running")
    copies = snapshots()
    if not copies or time.time() - (copies[-1] / "manifest.json").stat().st_mtime > 27 * 3600:
        issues.append("full backup older than 27 hours or missing")
    if copies:
        if json.loads((copies[-1] / "manifest.json").read_text())["server_uuid"] != sql(
            "SELECT @@server_uuid"
        ):
            issues.append("source database identity changed")
        first = json.loads((copies[0] / "manifest.json").read_text())["binlog"]["file"]
        archived = sorted(
            p.name for p in (STORE / "binlogs").glob("binlog.*") if BINLOG.fullmatch(p.name)
        )
        needed = [name for name in archived if name >= first]
        if (
            not needed
            or needed[0] != first
            or any(
                int(right.split(".")[1]) != int(left.split(".")[1]) + 1
                for left, right in zip(needed, needed[1:])
            )
        ):
            issues.append("missing archive segment in recovery chain")
    source = sql("SHOW BINARY LOG STATUS").split()
    if len(source) < 2 or not BINLOG.fullmatch(source[0]):
        raise RuntimeError("Invalid source log coordinates")
    file = STORE / "binlogs" / source[0]
    if not file.exists() or file.stat().st_size < int(source[1]):
        # Allow an in-flight event; no database writes are generated by this check.
        time.sleep(2)
    size = file.stat().st_size if file.exists() else 0
    if size < int(source[1]):
        issues.append("archive behind sampled source position")
    for path in (STORE / "binlogs").glob("binlog.*"):
        if BINLOG.fullmatch(path.name):
            with path.open("rb") as opened:
                os.fsync(opened.fileno())
    sync_directory(STORE / "binlogs")
    if shutil.disk_usage(STORE).free < 10 * 1024**3:
        issues.append("less than 10 GiB free")
    status = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "issues": issues,
        "source_file": source[0],
        "source_position": int(source[1]),
        "archived_bytes": size,
        "latest_full": copies[-1].name if copies else None,
    }
    atomic_json(STORE / "status.json", status)
    print(json.dumps(status))
    if issues:
        raise RuntimeError("Backup health check failed; see status.json")


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("full", "stream", "check"))
    action = parser.parse_args().action
    STORE.mkdir(mode=0o700, parents=True, exist_ok=True)
    (STORE / "binlogs").mkdir(mode=0o700, exist_ok=True)
    try:
        globals()[action]()
    except Exception as error:
        # Exception text from Docker/SQL can include private data; do not dump it.
        print(json.dumps({"action": action, "failed": type(error).__name__}))
        raise SystemExit(1) from None
