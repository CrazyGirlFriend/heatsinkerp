"""Offline packaging safety tests; no server, Docker or business data access."""

import copy
import gzip
import importlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
offline = importlib.import_module("export_offline_release")
installer = importlib.import_module("install_database_backup")


class OfflineReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.release = self.root / "releases" / "tested-release"
        self.release.mkdir(parents=True)
        (self.root / "current").symlink_to(self.release)
        (self.root / "bin").mkdir()
        (self.root / "bin/docker-compose").write_text("compose")
        (self.root / "backup-client-image").write_text("sha256:backup")
        (self.release / "result.json").write_text(
            json.dumps({"status": "success", "revision": "a" * 40})
        )
        for name in ("backend", "frontend", "scripts"):
            (self.release / name).mkdir()
            (self.release / name / "source.txt").write_text("source")
        for name in ("README.md", ".env.example", "docker-compose.server.yml"):
            (self.release / name).write_text("example")
        self.manifest = {
            "format": 1,
            "release": self.release.name,
            "revision": "a" * 40,
            "images": {
                name: {"id": "sha256:" + name, "platform": "linux/amd64"}
                for name in (*offline.SERVICES, "backup")
            },
        }
        self.output = self.root / "bundle"

    def fake_images(self, images, path):
        with gzip.open(path, "wb") as output:
            output.write(b"image archive")

    def export(self):
        with (
            patch.object(offline, "inventory", return_value=(self.release, self.manifest)),
            patch.object(offline, "export_images", side_effect=self.fake_images),
            patch.object(offline, "run", return_value="2.32.4"),
        ):
            return offline.write_bundle(self.root, self.output)

    def test_bundle_has_all_images_tools_and_source_without_secrets_or_build_outputs(self):
        for name in (".env", "private.key"):
            (self.release / "backend" / name).write_text("private")
        (self.release / "frontend/node_modules").mkdir()
        (self.release / "frontend/node_modules/leak").write_text("dependency")
        (self.release / "backend/link").symlink_to(self.root)
        self.export()
        manifest = offline.verify_bundle(self.output)
        self.assertEqual(set(manifest["images"]), {*offline.SERVICES, "backup"})
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        with tarfile.open(self.output / "source.tar.gz") as archive:
            names = archive.getnames()
        self.assertIn("backend/source.txt", names)
        self.assertIn("scripts/source.txt", names)
        self.assertFalse(
            any("node_modules" in n or n.endswith((".env", ".key", "/link")) for n in names)
        )
        overlay = json.loads((self.output / "compose.offline.json").read_text())
        self.assertEqual(set(overlay["services"]), set(offline.SERVICES))
        for name, service in overlay["services"].items():
            self.assertEqual(service, {"image": "sha256:" + name, "pull_policy": "never"})

    def test_existing_bundle_is_never_overwritten(self):
        self.export()
        old = (self.output / "manifest.json").read_bytes()
        with self.assertRaises(FileExistsError):
            self.export()
        self.assertEqual(old, (self.output / "manifest.json").read_bytes())

    def test_corruption_and_missing_required_files_are_rejected(self):
        self.export()
        p = self.output / "source.tar.gz"
        p.write_bytes(p.read_bytes() + b"tampered")
        with self.assertRaisesRegex(RuntimeError, "checksum"):
            offline.verify_bundle(self.output)
        manifest = json.loads((self.output / "manifest.json").read_text())
        del manifest["files"]["source.tar.gz"]
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, "Incomplete"):
            offline.verify_bundle(self.output)

    def test_unsafe_manifest_path_is_rejected(self):
        self.export()
        manifest = json.loads((self.output / "manifest.json").read_text())
        manifest["files"]["../outside"] = "ignored"
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, "Unsafe"):
            offline.verify_bundle(self.output)

    def test_changed_running_image_never_produces_success_manifest(self):
        changed = copy.deepcopy(self.manifest)
        changed["images"]["db"]["id"] = "sha256:another"
        with (
            patch.object(
                offline,
                "inventory",
                side_effect=[(self.release, self.manifest), (self.release, changed)],
            ),
            patch.object(offline, "export_images", side_effect=self.fake_images),
            patch.object(offline, "run", return_value="2.32.4"),
        ):
            with self.assertRaisesRegex(RuntimeError, "changed"):
                offline.write_bundle(self.root, self.output)
        self.assertFalse((self.output / "manifest.json").exists())

    def test_failed_docker_export_is_not_published(self):
        class Process:
            stdout = io.BytesIO(b"incomplete")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.stdout.close()

            def wait(self):
                return 1

        with patch.object(offline.subprocess, "Popen", return_value=Process()):
            with self.assertRaisesRegex(RuntimeError, "export failed"):
                offline.export_images(self.manifest["images"], self.root / "images.tar.gz")
        self.assertFalse((self.root / "images.tar.gz").exists())

    def test_write_failure_terminates_only_the_export_process(self):
        class Process:
            stdout = io.BytesIO(b"image")
            killed = False

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.stdout.close()

            def kill(self):
                self.killed = True

        process = Process()
        with (
            patch.object(offline.subprocess, "Popen", return_value=process),
            patch.object(offline.gzip, "open", side_effect=OSError("disk full")),
        ):
            with self.assertRaises(OSError):
                offline.export_images(self.manifest["images"], self.root / "images.tar.gz")
        self.assertTrue(process.killed)
        self.assertFalse((self.root / "images.tar.gz").exists())

    def test_inventory_rejects_unhealthy_service_and_mixed_architectures(self):
        unhealthy = False
        mixed = False

        def run(args):
            if args[1] == "inspect":
                name = args[2].split("-")[1]
                return json.dumps(
                    [
                        {
                            "Image": "sha256:" + name,
                            "Config": {
                                "Image": name + ":tested",
                                "Labels": {
                                    "com.docker.compose.project": "heatsinkrep",
                                    "com.docker.compose.service": name,
                                },
                            },
                            "State": {
                                "Running": True,
                                "Health": {"Status": "unhealthy" if unhealthy else "healthy"},
                            },
                        }
                    ]
                )
            return json.dumps(
                [
                    {
                        "Os": "linux",
                        "Architecture": "arm64" if mixed and args[-1] == "sha256:mq" else "amd64",
                        "Size": 123,
                    }
                ]
            )

        with patch.object(offline, "run", side_effect=run) as calls:
            _, manifest = offline.inventory(self.root)
            self.assertEqual(len(manifest["images"]), 5)
            self.assertTrue(all(c.args[0][1] in ("inspect", "image") for c in calls.call_args_list))
            unhealthy = True
            with self.assertRaisesRegex(RuntimeError, "unhealthy"):
                offline.inventory(self.root)
            unhealthy, mixed = False, True
            with self.assertRaisesRegex(RuntimeError, "platforms"):
                offline.inventory(self.root)


class OfflineBackupInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for attr, value in (
            ("ROOT", self.root),
            ("CLIENT", self.root / "backup-client.cnf"),
            ("STORE", self.root / "backups/continuous"),
        ):
            patcher = patch.object(installer.backup, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_existing_credentials_or_chain_are_never_overwritten(self):
        for path in (installer.backup.CLIENT, installer.backup.STORE):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("old")
            with (
                patch.object(installer.os, "geteuid", return_value=0),
                patch.object(installer.backup, "run") as run,
            ):
                with self.assertRaisesRegex(RuntimeError, "fresh"):
                    installer.install("sha256:test")
            run.assert_not_called()
            self.assertEqual(path.read_text(), "old")
            path.unlink()

    def test_mismatching_version_stops_before_creating_credentials(self):
        outputs = [
            subprocess.CompletedProcess([], 0, "sha256:test\n"),
            subprocess.CompletedProcess([], 0, "mysqlbinlog Ver 8.0.40"),
        ]
        with (
            patch.object(installer.os, "geteuid", return_value=0),
            patch.object(installer.backup, "run", side_effect=outputs),
            patch.object(installer.backup, "sql", return_value="8.4.11") as sql,
        ):
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                installer.install("sha256:test")
        self.assertFalse(installer.backup.CLIENT.exists())
        self.assertEqual(sql.call_count, 1)

    def test_offline_install_uses_loaded_image_and_makes_new_account_before_backup(self):
        def run(args, **kwargs):
            text = (
                "sha256:test\n"
                if args[:3] == ["docker", "image", "inspect"]
                else "mysqlbinlog Ver 8.4.11 for Linux"
            )
            return subprocess.CompletedProcess(args, 0, text)

        original_copy = installer.shutil.copyfile

        def copy(source, target):
            if str(target).startswith("/etc/systemd"):
                return
            return original_copy(source, target)

        with (
            patch.object(installer.os, "geteuid", return_value=0),
            patch.object(installer.backup, "run", side_effect=run) as calls,
            patch.object(installer.backup, "sql", side_effect=["8.4.11", "0", ""]) as sql,
            patch.object(installer.shutil, "copyfile", side_effect=copy),
        ):
            installer.install("sha256:test")
        self.assertIn("CREATE USER", sql.call_args_list[-1].args[0])
        commands = [c.args[0] for c in calls.call_args_list]
        self.assertIn("--pull", commands[1])
        self.assertIn("never", commands[1])
        self.assertTrue(any(cmd[-1] == "full" for cmd in commands))
        self.assertTrue(installer.backup.CLIENT.exists())
        self.assertEqual(installer.backup.CLIENT.stat().st_mode & 0o777, 0o600)
        self.assertTrue((self.root / "bin/database_backup.py").exists())
        self.assertFalse(any("build" in cmd or "pull" in cmd or "curl" in cmd for cmd in commands))


if __name__ == "__main__":
    unittest.main()
