"""Install recovery services on the existing application host (explicit --apply).

Build the matching client with backup/build-client.sh, or import it offline. No database restore,
application restart, port exposure, or production business writes are performed.
"""

import argparse
import os
import re
import secrets
import shutil
import subprocess
from pathlib import Path

import database_backup as backup


def install(client_image=None):
    if os.geteuid() != 0:
        raise RuntimeError("Run as root")
    image_file = backup.ROOT / "backup-client-image"
    if client_image:
        # A restored business database does not contain the old MySQL backup user.
        # Do not silently reuse credentials or a log chain from another server.
        if backup.CLIENT.exists() or backup.STORE.exists():
            raise RuntimeError(
                "Offline installation requires a fresh backup directory and credentials"
            )
        image = backup.run(
            ["docker", "image", "inspect", client_image, "--format", "{{.Id}}"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        version = backup.sql("SELECT VERSION()")
        client_version = backup.run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--pull",
                "never",
                "--entrypoint",
                "mysqlbinlog",
                image,
                "--version",
            ],
            capture_output=True,
            text=True,
        ).stdout
        if not re.search(r"\bVer " + re.escape(version.split("-")[0]) + r"\b", client_version):
            raise RuntimeError("Imported backup client does not match the database version")
        image_file.write_text(image + "\n")
        image_file.chmod(0o600)
    if not image_file.exists():
        raise RuntimeError("Build or import the matching backup client image first")
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
    destination.parent.mkdir(parents=True, exist_ok=True)
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
    parser.add_argument(
        "--client-image", help="Already loaded matching mysqlbinlog image; no download"
    )
    args = parser.parse_args()
    os.umask(0o077)
    try:
        install(args.client_image)
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print("Backup installation failed:", type(error).__name__)
        raise SystemExit(1) from None
