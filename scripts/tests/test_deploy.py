"""Deployment safety tests. All Docker/SSH calls are mocked; no server is contacted."""
import gzip
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "deploy_server.py"
spec = importlib.util.spec_from_file_location("deploy_server", SCRIPT)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
TAG = "20260929T000000Z-" + "a" * 12
REVISION = "a" * 40


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.previous = self.root / "releases" / "old"
        self.previous.mkdir(parents=True)
        (self.root / "current").symlink_to(self.previous)
        (self.root / ".env").write_text("MYSQL_PASSWORD='a$b#c'\nRELEASE_TAG=old\nFRONTEND_RELEASE_TAG=old-ui\n")
        self.instance = deploy.Deployment(self.root, TAG, REVISION)
        self.instance.release.mkdir()
        self.events = []

    def fake_existing(self):
        self.instance.old = {name: {"Id": "old-" + name, "Config": {"Image": name + ":old"}}
                             for name in ("db", "mq", "backend", "frontend")}

    def publish_with_failure(self, fail_at=None):
        self.fake_existing()

        def dc(*args, **kwargs):
            self.events.append(tuple(args))
            if args[0] == fail_at:
                raise RuntimeError("simulated failure")

        def backup():
            self.events.append(("backup",))
            if fail_at == "backup":
                raise RuntimeError("backup failure")

        def verify():
            self.events.append(("verify",))
            if fail_at == "verify":
                raise RuntimeError("health failure")

        with patch.object(self.instance, "check_existing"), patch.object(self.instance, "dc", side_effect=dc), \
                patch.object(self.instance, "backup_database", side_effect=backup), \
                patch.object(self.instance, "verify", side_effect=verify), \
                patch.object(self.instance, "wait_healthy"), \
                patch.object(deploy, "run", side_effect=lambda args, **kw: self.events.append(tuple(args))):
            try:
                self.instance.publish()
            except RuntimeError:
                self.instance.handle_failure()

    def test_success_orders_backup_migration_backend_and_frontend(self):
        self.publish_with_failure()
        commands = self.events
        backup = commands.index(("backup",))
        migrate = commands.index(("run", "--rm", "--no-deps", "-T", "--entrypoint", "alembic", "backend", "upgrade", "head"))
        backend = commands.index(("up", "-d", "--no-build", "--no-deps", "backend"))
        frontend = commands.index(("up", "-d", "--no-build", "--no-deps", "frontend"))
        self.assertLess(backup, migrate)
        self.assertLess(migrate, backend)
        self.assertLess(backend, frontend)
        self.assertEqual((self.root / "current").resolve(), self.instance.release)
        config = (self.root / ".env").read_text()
        self.assertIn("MYSQL_PASSWORD='a$b#c'", config)
        self.assertIn("FRONTEND_RELEASE_TAG=" + TAG, config)
        self.assertEqual((self.root / ".env").stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((self.instance.release / "result.json").read_text())["status"], "success")
        self.assertFalse(any("down" in command or "prune" in command for command in commands))
        self.assertFalse(any(command[0] == "up" and command[-1] in ("db", "mq") for command in commands))

    def test_build_failure_does_not_stop_or_migrate(self):
        self.publish_with_failure("build")
        self.assertFalse(self.instance.stopped)
        self.assertEqual(self.events, [("build", "backend")])
        self.assertEqual((self.root / "current").resolve(), self.previous)

    def test_backup_failure_restarts_old_containers_and_never_migrates(self):
        self.publish_with_failure("backup")
        self.assertIn(("docker", "start", "old-backend"), self.events)
        self.assertIn(("docker", "start", "old-frontend"), self.events)
        self.assertFalse(any(command[0] == "run" for command in self.events))
        self.assertFalse(self.instance.migration_started)
        self.assertIn("RELEASE_TAG=old", (self.root / ".env").read_text())

    def test_migration_failure_keeps_writes_closed_without_db_rollback(self):
        self.publish_with_failure("run")
        self.assertTrue(self.instance.migration_started)
        self.assertEqual(self.events[-1], ("stop", "frontend", "backend"))
        self.assertFalse(any(command[:2] == ("docker", "start") for command in self.events))
        self.assertFalse(any(command[0] == "up" for command in self.events))
        self.assertEqual((self.root / "current").resolve(), self.previous)

    def test_health_failure_does_not_switch_current_or_config(self):
        self.publish_with_failure("verify")
        self.assertEqual(self.events[-1], ("stop", "frontend", "backend"))
        self.assertEqual((self.root / "current").resolve(), self.previous)
        self.assertIn("RELEASE_TAG=old", (self.root / ".env").read_text())

    def test_tag_update_preserves_secrets_comments_and_unrelated_settings(self):
        source = "# Config\nMYSQL_PASSWORD='x$y#z'\n export RELEASE_TAG = old\nFRONTEND_RELEASE_TAG=old-ui\nMQ_PASSWORD=keep\n"
        updated = deploy.update_tags(source, TAG)
        self.assertIn("MYSQL_PASSWORD='x$y#z'", updated)
        self.assertIn("MQ_PASSWORD=keep", updated)
        self.assertIn("RELEASE_TAG=" + TAG, updated)
        self.assertNotIn("old-ui", updated)
        self.assertEqual(deploy.update_tags(updated, TAG), updated)

    def test_tag_update_adds_missing_frontend_override(self):
        self.assertEqual(deploy.update_tags("RELEASE_TAG=old", TAG),
                         f"RELEASE_TAG={TAG}\nFRONTEND_RELEASE_TAG={TAG}\n")

    def make_archive(self, name, kind=tarfile.REGTYPE):
        archive = self.root / "source.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            info = tarfile.TarInfo(name)
            info.type = kind
            if kind == tarfile.SYMTYPE:
                info.linkname = "/etc"
            output.addfile(info, io.BytesIO())
        return archive

    def test_unsafe_archive_is_rejected_before_any_extraction(self):
        for name, kind in (("../escape", tarfile.REGTYPE), ("/tmp/escape", tarfile.REGTYPE),
                           ("backend/.env", tarfile.REGTYPE), ("link", tarfile.SYMTYPE)):
            with self.subTest(name=name):
                with self.assertRaises(RuntimeError):
                    deploy.extract_source(self.make_archive(name, kind), self.instance.release)
                self.assertEqual(list(self.instance.release.iterdir()), [])

    def test_normal_git_style_archive_extracts(self):
        deploy.extract_source(self.make_archive("README.md"), self.instance.release)
        self.assertTrue((self.instance.release / "README.md").is_file())

    def backup_process(self, content, code):
        class Process:
            stdout = io.BytesIO(content)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.stdout.close()

            def wait(self):
                return code
        return Process()

    def test_dump_error_cannot_be_hidden_by_gzip_success(self):
        self.fake_existing()
        with patch.object(deploy.subprocess, "Popen", return_value=self.backup_process(b"partial", 2)):
            with self.assertRaisesRegex(RuntimeError, "备份失败"):
                self.instance.backup_database()
        self.assertFalse((self.instance.backup / "database.sql.gz").exists())

    def test_empty_dump_is_rejected(self):
        self.fake_existing()
        with patch.object(deploy.subprocess, "Popen", return_value=self.backup_process(b"", 0)):
            with self.assertRaisesRegex(RuntimeError, "完成标记"):
                self.instance.backup_database()

    def test_backup_contains_checked_sql_config_and_digest(self):
        self.fake_existing()
        sql = b"CREATE TABLE example (id int);\n-- Dump completed on 2026-09-29\n"
        with patch.object(deploy.subprocess, "Popen", return_value=self.backup_process(sql, 0)) as process:
            self.instance.backup_database()
        self.assertNotIn("a$b#c", " ".join(process.call_args.args[0]))
        with gzip.open(self.instance.backup / "database.sql.gz", "rb") as content:
            self.assertEqual(content.read(), sql)
        self.assertTrue((self.instance.backup / "database.sql.gz.sha256").exists())
        self.assertEqual((self.instance.backup / "config.env").read_text(), (self.root / ".env").read_text())

    def test_healthy_wait_is_bounded(self):
        with patch.object(self.instance, "container", return_value={"State": {"Running": True, "Health": {"Status": "starting"}}}), \
                patch.object(deploy.time, "monotonic", side_effect=[0, 1, 181]), \
                patch.object(deploy.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "180"):
                self.instance.wait_healthy("backend")

    def configuration(self):
        environments = {
            "db": {"MYSQL_DATABASE": "example", "MYSQL_USER": "example",
                   "MYSQL_PASSWORD": "db-secret", "MYSQL_ROOT_PASSWORD": "root-secret"},
            "mq": {"RABBITMQ_DEFAULT_USER": "example", "RABBITMQ_DEFAULT_PASS": "mq-secret"},
            "backend": {}, "frontend": {},
        }
        records = {}
        config = {"services": {}}
        for name, environment in environments.items():
            image = f"heatsinkrep-{name}:{TAG}"
            config["services"][name] = {"environment": environment, "image": image}
            volume = "heatsinkrep_mysql_data" if name == "db" else "heatsinkrep_rabbitmq_data"
            records[name] = {"Id": "original-" + name, "Config": {
                "Env": [key + "=" + value for key, value in environment.items()], "Image": image},
                "State": {"Running": True, "StartedAt": "before", "Health": {"Status": "healthy"}},
                "Mounts": [{"Name": volume}]}
        return config, records

    def test_preflight_checks_running_credentials_and_named_volumes(self):
        config, records = self.configuration()
        with patch.object(self.instance, "dc", return_value=json.dumps(config)), \
                patch.object(self.instance, "container", side_effect=lambda name: records[name]):
            self.instance.check_existing()
            records["db"]["Config"]["Env"] = ["MYSQL_PASSWORD=different"]
            with self.assertRaisesRegex(RuntimeError, "配置与运行环境不一致") as error:
                self.instance.check_existing()
            self.assertNotIn("db-secret", str(error.exception))
            config, records = self.configuration()
            records["db"]["Mounts"] = [{"Name": "other_database"}]
            with self.assertRaisesRegex(RuntimeError, "数据卷"):
                self.instance.check_existing()

    def test_preflight_rejects_unhealthy_existing_service(self):
        config, records = self.configuration()
        records["mq"]["State"]["Health"]["Status"] = "unhealthy"
        with patch.object(self.instance, "dc", return_value=json.dumps(config)), \
                patch.object(self.instance, "container", side_effect=lambda name: records[name]):
            with self.assertRaisesRegex(RuntimeError, "mq 不健康"):
                self.instance.check_existing()

    def test_verification_reads_only_and_checks_database_not_restarted(self):
        _, records = self.configuration()
        import copy
        self.instance.old = copy.deepcopy(records)
        with patch.object(self.instance, "wait_healthy"), \
                patch.object(self.instance, "container", side_effect=lambda name: records[name]), \
                patch.object(self.instance, "dc") as dc:
            self.instance.verify()
            self.assertEqual(dc.call_count, 4)
            self.assertTrue(all(call.args[:4] == ("exec", "-T", "frontend", "wget") for call in dc.call_args_list))
            records["db"]["State"]["StartedAt"] = "after"
            with self.assertRaisesRegex(RuntimeError, "db 身份"):
                self.instance.verify()

    def test_verification_rejects_old_application_image(self):
        _, records = self.configuration()
        records["backend"]["Config"]["Image"] = "heatsinkrep-backend:old"
        with patch.object(self.instance, "wait_healthy"), \
                patch.object(self.instance, "container", side_effect=lambda name: records[name]):
            with self.assertRaisesRegex(RuntimeError, "没有运行本次镜像"):
                self.instance.verify()

    def test_container_requires_one_instance_and_correct_project_label(self):
        with patch.object(self.instance, "dc", return_value="one two"):
            with self.assertRaisesRegex(RuntimeError, "单实例"):
                self.instance.container("backend")
        with patch.object(self.instance, "dc", return_value="one"), \
                patch.object(self.instance, "inspect", return_value={"Config": {"Labels": {
                    "com.docker.compose.project": "another-project", "com.docker.compose.service": "backend"}}}):
            with self.assertRaisesRegex(RuntimeError, "不属于"):
                self.instance.container("backend")


class LauncherTests(unittest.TestCase):
    def test_preview_and_help_do_not_contact_server(self):
        # Fail loudly if either command were accidentally called.
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            for name in ("ssh", "scp"):
                command = directory / name
                command.write_text("#!/bin/sh\necho unexpected-network-call >&2\nexit 99\n")
                command.chmod(0o700)
            import os
            env = dict(os.environ, PATH=str(directory) + ":" + os.environ["PATH"])
            for args in ([], ["--help"]):
                result = subprocess.run(["bash", str(SCRIPT.with_name("deploy.sh")), *args], env=env,
                                        text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("unexpected-network-call", result.stderr)

    def test_rejects_invalid_host_and_port(self):
        for args in (["--host", "-oProxyCommand=bad"], ["--port", "0"], ["--port", "65536"]):
            result = subprocess.run(["bash", str(SCRIPT.with_name("deploy.sh")), *args],
                                    text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
