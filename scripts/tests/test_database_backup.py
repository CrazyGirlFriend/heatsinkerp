"""Backup integrity and retention tests, no network or database access."""

import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

spec = importlib.util.spec_from_file_location(
    "backup", Path(__file__).parents[1] / "database_backup.py"
)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Path(self.temp.name)
        self.original = backup.STORE
        backup.STORE = self.store
        self.addCleanup(setattr, backup, "STORE", self.original)
        (self.store / "binlogs").mkdir()

    def test_new_database_identity_cannot_overwrite_old_chain(self):
        self.populate()
        manifest = self.store / "full-09" / "manifest.json"
        data = json.loads(manifest.read_text())
        data["server_uuid"] = "previous-source"
        manifest.write_text(json.dumps(data))
        with (
            patch.object(backup, "ROOT", self.store),
            patch.object(backup, "sql", return_value="new-source"),
        ):
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                backup.full()
        self.assertEqual(len(backup.snapshots()), 9)
        self.assertEqual([p.name for p in self.store.glob("pending-*")], ["pending-incomplete"])

    def test_coordinates_require_complete_gzip_dump(self):
        path = self.store / "database.sql.gz"
        sql = (
            "-- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='binlog.000003', SOURCE_LOG_POS=789;\n"
        )
        for content in (sql, "-- Dump completed on 2026-10-12\n"):
            with gzip.open(path, "wt") as f:
                f.write(content)
            with self.assertRaises(RuntimeError):
                backup.inspect_dump(path)
        with gzip.open(path, "wt") as f:
            f.write(sql + "-- Dump completed on 2026-10-12\n")
        self.assertEqual(backup.inspect_dump(path), {"file": "binlog.000003", "position": 789})
        path.write_bytes(path.read_bytes()[:-5])
        with self.assertRaises(EOFError):
            backup.inspect_dump(path)

    def populate(self):
        for number in range(1, 10):
            folder = self.store / f"full-{number:02}"
            folder.mkdir()
            (folder / "database.sql.gz").write_bytes(b"dump")
            (folder / "manifest.json").write_text(
                json.dumps(
                    {
                        "created_at": (
                            datetime.now(timezone.utc) - timedelta(days=9.5 - number)
                        ).isoformat(),
                        "sha256": backup.digest(folder / "database.sql.gz"),
                        "binlog": {"file": f"binlog.{number:06}"},
                    }
                )
            )
            (self.store / "binlogs" / f"binlog.{number:06}").write_bytes(b"log")
        (self.store / "pending-incomplete").mkdir()
        (self.store / "pre-deployment").mkdir()

    def test_retention_keeps_complete_chain_and_unrelated_backups(self):
        self.populate()
        backup.prune()
        self.assertEqual(
            [p.name for p in backup.snapshots()], [f"full-{n:02}" for n in range(2, 10)]
        )
        self.assertEqual(
            sorted(p.name for p in (self.store / "binlogs").iterdir()),
            [f"binlog.{n:06}" for n in range(2, 10)],
        )
        self.assertTrue((self.store / "pending-incomplete").exists())
        self.assertTrue((self.store / "pre-deployment").exists())

    def test_corrupt_retained_backup_stops_all_deletion(self):
        self.populate()
        (self.store / "full-09" / "database.sql.gz").write_bytes(b"corrupt")
        with self.assertRaises(RuntimeError):
            backup.prune()
        self.assertEqual(len(backup.snapshots()), 9)
        self.assertEqual(len(list((self.store / "binlogs").iterdir())), 9)


if __name__ == "__main__":
    unittest.main()
