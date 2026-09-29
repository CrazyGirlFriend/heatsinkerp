#!/usr/bin/env python3
"""Upgrade an existing Linux installation. Invoked by deploy.sh, never on the Mac."""
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
import sys
import tarfile
import time


def run(args, *, env=None, capture=False):
    return subprocess.run(args, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def update_tags(content, tag):
    # Do not source shell code from .env; preserve every unrelated setting/comment.
    for key in ("RELEASE_TAG", "FRONTEND_RELEASE_TAG"):
        pattern = rf"(?m)^[ \t]*(?:export[ \t]+)?{key}[ \t]*=.*$"
        line = f"{key}={tag}"
        if re.search(pattern, content):
            content = re.sub(pattern, line, content)
        else:
            content = content.rstrip("\n") + "\n" + line + "\n"
    return content


def extract_source(archive, target):
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        for member in members:
            path = Path(member.name)
            if (path.is_absolute() or ".." in path.parts or
                    not (member.isfile() or member.isdir()) or
                    any(part in (".env", ".git") for part in path.parts)):
                raise RuntimeError("发布包含不安全路径、链接或私密配置，拒绝解包")
        source.extractall(target, members=members)


class Deployment:
    def __init__(self, root, tag, revision):
        self.root = root
        self.tag = tag
        self.revision = revision
        self.release = root / "releases" / tag
        self.backup = root / "backups" / ("pre-" + tag)
        self.phase = "preflight"
        self.stopped = False
        self.migration_started = False
        self.old = {}
        self.console = sys.stdout
        self.env = dict(os.environ, RELEASE_TAG=tag, FRONTEND_RELEASE_TAG=tag)
        bundled = root / "bin" / "docker-compose"
        self.compose = [str(bundled)] if bundled.is_file() else ["docker", "compose"]

    def dc(self, *args, capture=False):
        return run(self.compose + ["--env-file", str(self.root / ".env"), "-p", "heatsinkrep",
                   "--project-directory", str(self.release), "-f",
                   str(self.release / "docker-compose.server.yml"), *args],
                   env=self.env, capture=capture)

    def inspect(self, container):
        return json.loads(run(["docker", "inspect", container], capture=True))[0]

    def container(self, service):
        ids = self.dc("ps", "-q", "--all", service, capture=True).split()
        if len(ids) != 1:
            raise RuntimeError(f"{service} 不是单实例现有服务，拒绝自动升级")
        data = self.inspect(ids[0])
        labels = data["Config"]["Labels"]
        if (labels.get("com.docker.compose.project") != "heatsinkrep" or
                labels.get("com.docker.compose.service") != service):
            raise RuntimeError("容器不属于 heatsinkrep，拒绝操作")
        return data

    def stage(self, phase, message):
        self.phase = phase
        print(message, flush=True)
        if self.console is not sys.stdout:
            print(message, file=self.console, flush=True)
        self.save_result("running")

    def save_result(self, status):
        result = {"status": status, "phase": self.phase, "revision": self.revision,
                  "tag": self.tag, "backup": str(self.backup),
                  "migration_started": self.migration_started}
        (self.release / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")

    def wait_healthy(self, service, seconds=180):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            state = self.container(service)["State"]
            if state.get("Running") and state.get("Health", {}).get("Status") == "healthy":
                return
            if not state.get("Running"):
                raise RuntimeError(f"{service} 已退出；检查该容器日志")
            time.sleep(3)
        raise RuntimeError(f"{service} 未在 {seconds} 秒内通过健康检查")

    def check_existing(self):
        self.dc("config", "--quiet")
        config = json.loads(self.dc("config", "--format", "json", capture=True))
        for service in ("db", "mq", "backend", "frontend"):
            data = self.container(service)
            if not data["State"].get("Running") or data["State"].get("Health", {}).get("Status") != "healthy":
                raise RuntimeError(f"现有 {service} 不健康，请先排障；本脚本不用于故障恢复/首次安装")
            self.old[service] = data
        # Refuse changing DB/MQ credentials/volumes behind the running services' back.
        for service, keys in (("db", ("MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD")),
                              ("mq", ("RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS"))):
            actual = dict(item.split("=", 1) for item in self.old[service]["Config"]["Env"])
            expected = config["services"][service]["environment"]
            if any(actual.get(key) != str(expected.get(key, "")) for key in keys):
                raise RuntimeError(f"{service} 配置与运行环境不一致，须人工核实；未显示密码")
            volume = "heatsinkrep_" + ("mysql_data" if service == "db" else "rabbitmq_data")
            if not any(mount.get("Name") == volume for mount in self.old[service]["Mounts"]):
                raise RuntimeError(f"{service} 数据卷不是预期命名卷，拒绝升级")
        images = [config["services"][name]["image"] for name in ("backend", "frontend")]
        if images != [f"heatsinkrep-backend:{self.tag}", f"heatsinkrep-frontend:{self.tag}"]:
            raise RuntimeError("应用镜像标签未正确解析")

    def backup_database(self):
        self.backup.mkdir(mode=0o700, parents=True, exist_ok=False)
        shutil.copyfile(self.root / ".env", self.backup / "config.env")
        (self.backup / "previous.json").write_text(json.dumps({
            "current": str((self.root / "current").resolve()),
            "images": {name: data["Config"]["Image"] for name, data in self.old.items()},
        }, indent=2) + "\n")
        partial = self.backup / "database.sql.gz.partial"
        command = ["docker", "exec", self.old["db"]["Id"], "sh", "-c",
                   'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --user=root '
                   '--single-transaction --quick --routines --triggers --events --hex-blob '
                   '--set-gtid-purged=OFF --no-tablespaces "$MYSQL_DATABASE"']
        with subprocess.Popen(command, stdout=subprocess.PIPE) as process:
            with gzip.open(partial, "wb") as output:
                shutil.copyfileobj(process.stdout, output)
            if process.wait() != 0:
                raise RuntimeError("数据库备份失败，禁止迁移")
        has_table = False
        complete = False
        with gzip.open(partial, "rb") as backup:
            for line in backup:
                has_table = has_table or line.startswith(b"CREATE TABLE")
                complete = complete or line.startswith(b"-- Dump completed on")
        if not has_table or not complete:
            raise RuntimeError("备份缺少表结构或完成标记，禁止迁移")
        final = self.backup / "database.sql.gz"
        partial.rename(final)
        digest = hashlib.sha256()
        with final.open("rb") as content:
            for chunk in iter(lambda: content.read(1024 * 1024), b""):
                digest.update(chunk)
        (self.backup / "database.sql.gz.sha256").write_text(digest.hexdigest() + "  database.sql.gz\n")

    def verify(self):
        self.wait_healthy("backend")
        self.wait_healthy("frontend")
        for service in ("backend", "frontend"):
            if self.container(service)["Config"]["Image"] != f"heatsinkrep-{service}:{self.tag}":
                raise RuntimeError(f"{service} 没有运行本次镜像")
        # GET only, from the real Nginx entry; no login or inventory test writes.
        for path in ("/", "/factory-analysis", "/healthz", "/api/health"):
            self.dc("exec", "-T", "frontend", "wget", "-T", "10", "-q", "-O", "/dev/null", "http://127.0.0.1" + path)
        for service in ("db", "mq"):
            data = self.container(service)
            if (data["Id"] != self.old[service]["Id"] or
                    data["State"]["StartedAt"] != self.old[service]["State"]["StartedAt"] or
                    data["State"].get("Health", {}).get("Status") != "healthy"):
                raise RuntimeError(f"{service} 身份/启动时间/健康状态发生变化，请检查")

    def publish(self):
        self.check_existing()
        self.stage("build", "1/5 构建前后端镜像；此时原服务继续运行")
        self.dc("build", "backend")
        self.dc("build", "frontend")
        # Stop the public entrance first, then finish/stop backend writers.
        self.stage("backup", "2/5 暂停访问与写入，备份数据库和私密配置")
        self.stopped = True
        run(["docker", "stop", "--time", "30", self.old["frontend"]["Id"]])
        run(["docker", "stop", "--time", "60", self.old["backend"]["Id"]])
        self.backup_database()
        self.migration_started = True
        self.stage("migrate", "3/5 使用新后端迁移数据库；不清库，不导入演示数据")
        self.dc("run", "--rm", "--no-deps", "-T", "--entrypoint", "alembic", "backend", "upgrade", "head")
        self.stage("start", "4/5 更新后端，通过健康检查后更新前端")
        self.dc("up", "-d", "--no-build", "--no-deps", "backend")
        self.wait_healthy("backend")
        self.dc("up", "-d", "--no-build", "--no-deps", "frontend")
        self.stage("verify", "5/5 检查网页、API 与数据库/MQ，保存发布版本")
        self.verify()
        # Persistent version markers change only after the candidate passes checks.
        next_env = self.root / (".env.next-" + self.tag)
        next_env.write_text(update_tags((self.root / ".env").read_text(), self.tag))
        original = (self.root / ".env").stat()
        os.chown(next_env, original.st_uid, original.st_gid)
        next_env.chmod(0o600)
        next_env.replace(self.root / ".env")
        next_link = self.root / (".current-" + self.tag)
        next_link.symlink_to(self.release)
        next_link.replace(self.root / "current")
        self.phase = "complete"
        self.save_result("success")
        print(f"发布成功：{self.tag}\n备份：{self.backup}", flush=True)

    def handle_failure(self):
        if self.stopped:
            if not self.migration_started:
                # The old containers still exist and the schema has not been touched.
                run(["docker", "start", self.old["backend"]["Id"]])
                self.wait_healthy("backend")
                run(["docker", "start", self.old["frontend"]["Id"]])
                print("迁移尚未开始，已恢复旧应用。", flush=True)
            else:
                self.dc("stop", "frontend", "backend")
                print("迁移已经开始，应用保持停写。请检查日志并人工处理；不会自动降级或覆盖数据库。", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}", args.tag) or not re.fullmatch(r"[0-9a-f]{40}", args.revision):
        parser.error("版本号或 Git 提交无效")
    if not args.tag.endswith(args.revision[:12]):
        parser.error("版本号与 Git 提交不一致")
    if sys.platform != "linux" or os.geteuid() != 0:
        parser.error("仅允许在 Linux 服务器上通过 sudo 运行")
    os.umask(0o077)
    root = Path("/opt/heatsinkrep")
    if not (root / ".env").is_file() or not (root / "current").is_symlink() or not (root / "current").is_dir():
        parser.error("缺少已有 .env/current；本脚本只升级现有部署")
    with (root / ".deploy.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("另一个发布正在进行，请勿并发部署")
        deploy = Deployment(root, args.tag, args.revision)
        deploy.release.mkdir(mode=0o700, parents=True, exist_ok=False)
        extract_source(args.archive, deploy.release)
        # Keep full build/migration output only in the protected server log.
        with (deploy.release / "deploy.log").open("a") as log:
            print(f"发布日志：{deploy.release}/deploy.log", flush=True)
            deploy.console = os.fdopen(os.dup(1), "w")
            os.dup2(log.fileno(), 1)
            os.dup2(log.fileno(), 2)
            try:
                deploy.publish()
            except BaseException:
                import traceback
                traceback.print_exc()
                deploy.save_result("failed")
                try:
                    deploy.handle_failure()
                except BaseException:
                    traceback.print_exc()
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
