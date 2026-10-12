"""Install recovery services on the existing application host (explicit --apply).

Build the matching client with backup/build-client.sh first. No database restore,
application restart, port exposure, or production business writes are performed.
"""

import argparse
import os
from pathlib import Path
import secrets
import shutil
import subprocess

import database_backup as backup


def install():
    if os.geteuid() != 0 or not (backup.ROOT / "backup-client-image").exists():
        raise RuntimeError("Run as root after building the matching backup client image")
    source = Path(__file__).resolve().parent
    if not backup.CLIENT.exists():
        exists = backup.sql("SELECT COUNT(*) FROM mysql.user WHERE user='heatsink_backup'")
        if exists != "0":
            raise RuntimeError("Backup user already exists but private client file is missing")
        password = secrets.token_hex(32)
        backup.sql(
            "CREATE USER 'heatsink_backup'@'%' IDENTIFIED BY '" + password + "' REQUIRE SSL; "
            "GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'heatsink_backup'@'%'"
        )
        backup.CLIENT.write_text(
            "[client]\nhost=db\nuser=heatsink_backup\npassword="
            + password
            + "\nssl-mode=REQUIRED\n"
        )
        backup.CLIENT.chmod(0o600)
    destination = backup.ROOT / "bin" / "database_backup.py"
    shutil.copyfile(source / "database_backup.py", destination)
    destination.chmod(0o700)
    for path in (source / "systemd").glob("heatsinkrep-backup-*"):
        shutil.copyfile(path, Path("/etc/systemd/system") / path.name)
    backup.run(["systemctl", "daemon-reload"])
    backup.run(["python3", str(destination), "full"])
    backup.run(
        [
            "systemctl",
            "enable",
            "--now",
            "heatsinkrep-backup-stream.service",
            "heatsinkrep-backup-full.timer",
            "heatsinkrep-backup-check.timer",
        ]
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", required=True)
    parser.parse_args()
    os.umask(0o077)
    try:
        install()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print("Backup installation failed:", type(error).__name__)
        raise SystemExit(1) from None
