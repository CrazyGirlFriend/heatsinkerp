# 新服务器部署与整套系统迁移

适用项目：热沉物料流转管理系统（HeatSinkERP）。本文是操作手册，不表示已执行迁移，也不表示待发布版本已经上线。

## 1. 先区分两种情况

| 目的 | 使用哪一节 | 原有数据 |
| --- | --- | --- |
| 在新服务器安装一套空系统 | 第 3 节 | 不包含旧账号、库存、转料记录 |
| 把现有系统完整搬到新服务器 | 第 4 节 | 备份、恢复后保留 |

迁移现有系统时，不要同时升级程序、MySQL 或数据库结构。先搬迁实际运行的同一版本，验收后再单独升级。GitHub 中只有代码和示例配置，没有业务数据库、实际密码或密钥。

当前系统包含前端、后端、MySQL、RabbitMQ 四个业务服务，以及独立的持续备份客户端和 systemd 定时任务。第 4 节是完整离线迁移流程，包含 MQ 停机备份和新备份链安装。

## 2. 文件和数据分别放在哪里

| 内容 | 当前服务器位置 | 迁移方法 |
| --- | --- | --- |
| 各版本代码及发布文件 | `/opt/heatsinkrep/releases/` | 带走与运行镜像配套的源码目录 |
| 当前版本入口 | `/opt/heatsinkrep/current` | 新服务器重新建立软链接 |
| 密码、访问锁、签名及加密密钥 | `/opt/heatsinkrep/.env` | 安全复制，权限设为 `600` |
| 数据库备份 | `/opt/heatsinkrep/backups/` | 保留一份异机备份 |
| Docker 镜像存储 | `/var/lib/docker/` 下，由 Docker 分层管理 | 使用 `docker image save/load`，不要直接复制整个 Docker 目录 |
| MySQL 实际数据 | `/var/lib/docker/volumes/heatsinkrep_mysql_data/_data/` | 本手册使用 SQL 导出与恢复，不复制运行中的数据文件 |
| RabbitMQ 数据 | `/var/lib/docker/volumes/heatsinkrep_rabbitmq_data/_data/` | 停止业务及消息服务后备份；同时保留节点名、Erlang cookie 和配置，见异步/MQ 补充 |

数据库数据卷由 Compose 中的 `mysql_data` 定义自动创建。项目名固定为 `heatsinkrep` 时，实际卷名为 `heatsinkrep_mysql_data`，挂到数据库容器的 `/var/lib/mysql`。不必手动创建 `_data` 文件夹；新机器的实际磁盘位置以 `docker volume inspect heatsinkrep_mysql_data` 为准。

数据卷独立于容器，但仍在本机硬盘，不是云备份。更换服务器不会自动搬走数据。

以下命令在 Linux 服务器的 **Bash、root 管理会话**中分段执行（可先运行 `sudo -i`）。它们不是自动化一键脚本，不要整篇一次粘贴。命令报错时立即停下，不要跳过校验继续启动业务。

联网源码安装需要 Git；离线迁移不需要 Git。新服务器须安装 Docker Engine、Docker Compose v2；先检查 `docker version`、`docker compose version`。镜像搬迁要求新旧 CPU 架构兼容。跨架构时需要为目标平台重新构建并单独验证，不能直接套用本手册的镜像导入步骤。

## 3. 全新空系统部署

### 3.1 获取代码

仅用于尚未部署本项目的新服务器。私有仓库须先配置自己的 GitHub 访问权限，不把令牌写进下载地址。

```bash
mkdir -p /opt/heatsinkrep/releases
git clone https://github.com/CrazyGirlFriend/heatsinkerp.git /opt/heatsinkrep/releases/initial
cd /opt/heatsinkrep/releases/initial
```

正式部署应检出已验收的提交或发布版本，并记录 `git rev-parse HEAD`，不要默认将开发中的最新代码视为已验收版本。

### 3.2 填写配置

```bash
set -euo pipefail
test ! -e /opt/heatsinkrep/.env
umask 077
cp .env.example /opt/heatsinkrep/.env
chmod 600 /opt/heatsinkrep/.env
nano /opt/heatsinkrep/.env
```

如果 `.env` 已存在，先核实是不是已有部署，不要覆盖。

| 配置项 | 要求 |
| --- | --- |
| `MYSQL_DATABASE`、`MYSQL_USER` | 可保留示例名称 |
| `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD` | 改为不同的强密码，不能保留示例值 |
| `MQ_USER`、`MQ_PASSWORD` | 新版 RabbitMQ 账号及独立强密码；不公开消息队列端口 |
| `SEED_ADMIN_PASSWORD` | 新系统初始管理员密码，账号为 `admin` |
| `SITE_ACCESS_PASSWORD` | 登录前访问锁口令 |
| `SITE_ACCESS_SECRET` | 新生成的随机签名密钥 |
| `FRONTEND_PORT` | 建议 `8082`；根目录示例默认是 `8080`，需要明确修改 |
| `APP_ORIGIN` | 在文件中新增，填新站点实际地址，例如 `http://新服务器IP:8082`；不能沿用旧 IP |
| `SITE_ACCESS_SECURE_COOKIE` | 当前 HTTP 演示环境为 `false`；配置好 HTTPS 后才设为 `true` |
| `RELEASE_TAG`、`FRONTEND_RELEASE_TAG` | 可新增为本次发布标识；不填时新构建使用 `latest`，正式环境宜用可追溯版本号 |

生成 `SITE_ACCESS_SECRET` 后复制到配置文件，不提交到 Git：

```bash
openssl rand -hex 32
```

主系统地址、令牌和白名单未确定时留空，不主动启用对接。若该版本包含主系统配置页，还需为 `MAIN_SYSTEM_CONFIG_KEY` 生成独立密钥：

```bash
openssl rand -base64 32 | tr '+/' '-_'
```

该命令生成 Fernet 使用的 URL-safe Base64 编码 32 字节密钥。密钥生成一次后安全保存；后续升级、重启不重新生成。`MAIN_SYSTEM_ALLOWED_ORIGINS` 仅填写已确认的 HTTPS 主系统地址。实际令牌不要写进前端或 GitHub。

### 3.3 启动服务

在代码目录定义本次会话使用的快捷函数，明确指定服务器配置，避免误用本地 Compose 的端口映射：

```bash
cd /opt/heatsinkrep/releases/initial
dc() {
  docker compose --env-file /opt/heatsinkrep/.env -p heatsinkrep \
    -f /opt/heatsinkrep/releases/initial/docker-compose.server.yml "$@"
}
dc config --quiet
dc up -d --build
dc ps
```

Compose 自动创建数据库数据卷。后端启动时执行 Alembic 迁移，创建表和初始管理员。不要公开执行、粘贴完整的 `docker compose config` 输出，它可能包含密码；这里只使用 `--quiet` 校验。

确认所有服务均为 `healthy`（新版为前端、后端、MySQL、RabbitMQ 四个服务）。首次准备八个正式班组：

```bash
dc exec -T backend python -m app.configure_material_teams
ln -s /opt/heatsinkrep/releases/initial /opt/heatsinkrep/current
```

班组初始化只补正式班组，不生成库存或班组长账号。登录后由管理员设置班组长。

只开放需要的网页端口及受限 SSH 入口，不公开 MySQL `3306` 或后端 `8000`。访问 `http://新服务器IP:8082`，先输入访问口令，再用 `admin` 和设置的初始密码登录。正式使用前配置域名、HTTPS、反向代理及相应 Cookie/来源设置。

## 4. 现有系统离线迁移（四个业务服务 + 持续备份）

### 4.1 先准备程序包，不停业务

在旧服务器使用本次修订后的工具，先导出**正在运行的版本**。不从开发主目录打包，不构建最新镜像；本步骤不停止服务、不导出数据库或密码。目录必须是新目录，导出与发布共用锁。

```bash
sudo python3 scripts/export_offline_release.py --output /opt/heatsinkrep/offline/program-bundle
sudo python3 scripts/export_offline_release.py --output /opt/heatsinkrep/offline/program-bundle --apply
sudo python3 scripts/export_offline_release.py --verify /opt/heatsinkrep/offline/program-bundle
```

程序包包含前端、后端、MySQL、RabbitMQ、mysqlbinlog 五个实际镜像 ID、对应源码、离线 Compose 镜像覆盖文件、已验证的 Compose 二进制、备份工具和本手册。`manifest.json` 记录程序提交、平台及每个文件的 SHA256。源码不含 `node_modules`、`dist`、本地草稿、输出目录或私密配置；运行时直接使用已导出的镜像。

目标服务器需要预装同架构的 Docker Engine、Python 3、Bash、gzip、tar、sha256sum、flock。**程序包不含操作系统或 Docker Engine 离线安装包**，须根据目标 Linux 发行版另外准备。当前实测为 Linux amd64，不能直接导入 ARM 或 Windows 容器环境。目标端不执行 npm、pip、curl、Git clone 或 `docker build/pull`。

### 4.2 在维护窗口捕获最终数据

先用隔离环境演练，确认后安排正式停写窗口。以下在旧服务器 root Bash 会话逐段执行。程序包准备后若又发布过应用，先重新导出程序包；不能用旧程序配新结构的数据。

```bash
set -euo pipefail
umask 077
bundle=/opt/heatsinkrep/offline/program-bundle
python3 "$bundle/migration-tools/export_offline_release.py" --verify "$bundle"
exec 9>/opt/heatsinkrep/.deploy.lock
flock -n 9
source_dir=$(readlink -f /opt/heatsinkrep/current)
python3 - "$bundle" "$source_dir" <<'PY'
import json, pathlib, subprocess, sys
manifest = json.loads((pathlib.Path(sys.argv[1]) / 'manifest.json').read_text())
assert pathlib.Path(sys.argv[2]).name == manifest['release'], '程序版本已变化，重新导出'
for service in ('db', 'mq', 'backend', 'frontend'):
    actual = subprocess.check_output(['docker', 'inspect', 'heatsinkrep-' + service + '-1',
                                     '--format', '{{.Image}}'], text=True).strip()
    assert actual == manifest['images'][service]['id'], '运行镜像已变化，重新导出'
PY
data_dir="/opt/heatsinkrep/backups/migration-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$data_dir"
cp -p /opt/heatsinkrep/.env "$data_dir/server.env"
cp "$bundle/manifest.json" "$data_dir/program-manifest.json"
dc() {
  /opt/heatsinkrep/bin/docker-compose --env-file /opt/heatsinkrep/.env -p heatsinkrep \
    -f "$source_dir/docker-compose.server.yml" "$@"
}
db_sql() {
  docker exec -i heatsinkrep-db-1 sh -c \
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot -N --batch "$MYSQL_DATABASE"'
}
dc stop frontend
# 前端入口已停，后端暂时保留以发送数据库中的待发通知。最多等待 60 秒。
for attempt in $(seq 1 30); do
  pending=$(printf '%s\n' 'SELECT COUNT(*) FROM notification_outbox WHERE published_at IS NULL;' | db_sql)
  [ "$pending" = 0 ] && break
  sleep 2
done
test "$pending" = 0
dc stop backend mq
printf '%s\n' 'SELECT version_num FROM alembic_version;' | db_sql > "$data_dir/schema.txt"
docker exec heatsinkrep-db-1 sh -c \
  'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump -uroot --single-transaction --quick --source-data=2 --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces "$MYSQL_DATABASE"' \
  | gzip > "$data_dir/database.sql.gz"
# MQ 必须已停止；同版本容器以 root 保留文件属主、权限及 Erlang cookie。
test "$(docker inspect heatsinkrep-mq-1 --format '{{.State.Running}}')" = false
mq_image=$(docker inspect heatsinkrep-mq-1 --format '{{.Image}}')
docker run --rm --pull never --network none --user 0 --entrypoint tar \
  -v heatsinkrep_rabbitmq_data:/data:ro "$mq_image" -C /data -czf - . \
  > "$data_dir/rabbitmq-data.tar.gz"
python3 - "$data_dir" <<'PY'
import gzip, pathlib, sys
path = pathlib.Path(sys.argv[1]) / 'database.sql.gz'
with gzip.open(path, 'rt') as stream:
    completed = any(line.startswith('-- Dump completed on ') for line in stream)
assert completed, 'SQL 备份缺少完成标记'
PY
gzip -t "$data_dir/database.sql.gz" "$data_dir/rabbitmq-data.tar.gz"
(cd "$data_dir" && sha256sum server.env program-manifest.json schema.txt database.sql.gz rabbitmq-data.tar.gz > SHA256SUMS)
printf '最终数据包：%s\n' "$data_dir"
flock -u 9
```

`notification_outbox` 是通知发送记录，不是待签收物料；不要求工厂清空所有待签收单据。任一步失败就停止后续操作，不能以残缺包继续恢复。若取消切换，先确认新端没有业务写入，再执行 `dc up -d --no-build --pull never mq backend frontend` 恢复旧端；正式切换时旧端保持停写。

将程序包和最终数据包分别安全传输为目标服务器的 `/opt/heatsinkrep/migration-bundle/`、`/opt/heatsinkrep/migration-data/`，目录权限 700。数据包有业务数据、密码和 cookie，不上传 Git，不放公开下载地址。旧全备和连续日志保存在源端或独立归档位置，不直接覆盖目标端的 `backups/continuous`。

### 4.3 在空目标服务器导入同版本程序

仅用于没有本项目容器、卷、配置或备份服务的新目标环境。遇到同名资源立即停止，不能删掉后重试。

```bash
set -euo pipefail
umask 077
bundle=/opt/heatsinkrep/migration-bundle
data_dir=/opt/heatsinkrep/migration-data
python3 "$bundle/migration-tools/export_offline_release.py" --verify "$bundle"
(cd "$data_dir" && sha256sum -c SHA256SUMS)
cmp "$bundle/manifest.json" "$data_dir/program-manifest.json"
gzip -t "$data_dir/database.sql.gz" "$data_dir/rabbitmq-data.tar.gz"
for volume in heatsinkrep_mysql_data heatsinkrep_rabbitmq_data; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    printf '目标已有数据卷 %s，停止恢复\n' "$volume"; exit 1
  fi
done
test -z "$(docker ps -aq --filter label=com.docker.compose.project=heatsinkrep)"
test -z "$(docker ps -aq --filter name=heatsinkrep-binlog-backup)"
test ! -e /opt/heatsinkrep/.env
test ! -e /opt/heatsinkrep/current
test ! -e /opt/heatsinkrep/backups/continuous
test ! -e /opt/heatsinkrep/backup-client.cnf
test ! -e /etc/systemd/system/heatsinkrep-backup-stream.service
python3 - "$bundle" <<'PY'
import json, pathlib, platform, sys
manifest = json.loads((pathlib.Path(sys.argv[1]) / 'manifest.json').read_text())
arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
assert platform.system() == 'Linux' and arch, '需要受支持的 Linux 架构'
assert all(i['platform'] == 'linux/' + arch for i in manifest['images'].values()), '镜像架构不匹配'
PY
gzip -dc "$bundle/images.tar.gz" | docker image load
python3 - "$bundle" <<'PY'
import json, pathlib, subprocess, sys
manifest = json.loads((pathlib.Path(sys.argv[1]) / 'manifest.json').read_text())
for image in manifest['images'].values():
    actual = subprocess.check_output(['docker', 'image', 'inspect', image['id'], '--format', '{{.Id}}'], text=True).strip()
    assert actual == image['id'], '未导入正确镜像'
PY
release_tag=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["release"])' "$bundle/manifest.json")
release_dir="/opt/heatsinkrep/releases/$release_tag"
test ! -e "$release_dir"
mkdir -p "$release_dir" /opt/heatsinkrep/bin
tar -xzf "$bundle/source.tar.gz" -C "$release_dir"
cp "$bundle/compose.offline.json" "$release_dir/compose.offline.json"
install -m 700 "$bundle/docker-compose" /opt/heatsinkrep/bin/docker-compose
cp "$data_dir/server.env" /opt/heatsinkrep/.env
chmod 600 /opt/heatsinkrep/.env
nano /opt/heatsinkrep/.env
```

必须修改 `APP_ORIGIN` 为新站点实际地址，核对 `FRONTEND_PORT`、Cookie/HTTPS 配置及主系统对接地址。首次恢复将 `PUBLIC_BIND_ADDRESS=127.0.0.1`，验收前只允许本机/受控隧道访问，避免用户误写。保留数据库、MQ 密码、签名密钥和 `MAIN_SYSTEM_CONFIG_KEY`；修改初始管理员环境变量不会重置已恢复账号密码。

### 4.4 先恢复 MySQL 和 RabbitMQ，再启动应用

```bash
dc() {
  /opt/heatsinkrep/bin/docker-compose --env-file /opt/heatsinkrep/.env -p heatsinkrep \
    -f "$release_dir/docker-compose.server.yml" -f "$release_dir/compose.offline.json" "$@"
}
dc config --quiet
dc up -d --no-build --pull never db
```

等 MySQL 为 `healthy` 后执行下一段。镜像覆盖文件用 ID 固定四个服务，并禁止自动拉取，不依赖可变标签。

```bash
test "$(dc exec -T db sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; mysql -uroot -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()" "$MYSQL_DATABASE"')" = 0
gzip -dc "$data_dir/database.sql.gz" \
  | dc exec -T db sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot "$MYSQL_DATABASE"'
dc exec -T db sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; mysql -uroot -N -e "SELECT version_num FROM alembic_version" "$MYSQL_DATABASE"' \
  > "$data_dir/restored-schema.txt"
cmp "$data_dir/schema.txt" "$data_dir/restored-schema.txt"
mq_image=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["images"]["mq"]["id"])' "$bundle/manifest.json")
docker volume create heatsinkrep_rabbitmq_data
docker run --rm -i --pull never --network none --user 0 --entrypoint sh \
  -v heatsinkrep_rabbitmq_data:/data "$mq_image" \
  -c 'test -z "$(ls -A /data)" && tar -xzpf - -C /data' < "$data_dir/rabbitmq-data.tar.gz"
dc up -d --no-build --pull never mq
dc ps
```

等待 MQ 也为 `healthy`。必须保留 Compose 的 `hostname: heatsink-mq`，卷内 cookie 和节点数据不可重建或覆盖。数据库和 MQ 恢复完成前，不启动后端消费者或任何演示/清库脚本。

```bash
dc up -d --no-build --pull never backend frontend
dc ps
ln -s "$release_dir" /opt/heatsinkrep/current
```

将本次恢复的程序提交、镜像 ID、源端数据包 SHA256、验收结果写入目标发布目录的部署记录；未验收之前不能标为成功，也不能把旧服务器的成功结果直接当作新服务器验收通过。

### 4.5 离线建立新服务器的持续备份链

SQL 导出仅含业务库，**不会带走 MySQL 系统库中的 `heatsink_backup` 账号**。不要复制旧的 `backup-client.cnf`，也不要把旧 binlog 放进新服务器的活动归档目录。保全旧恢复链后，在新主库创建独立归档账号及全备：

```bash
backup_image=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["images"]["backup"]["id"])' "$bundle/manifest.json")
python3 "$bundle/migration-tools/install_database_backup.py" --apply --client-image "$backup_image"
python3 /opt/heatsinkrep/bin/database_backup.py check
systemctl list-timers 'heatsinkrep-backup-*'
```

安装器只使用已导入镜像、核对 mysqlbinlog 与数据库版本，创建新凭据和第一份全备，再启用归档和定时器；无需访问 MySQL 下载站。旧主机 UUID 对应的恢复链继续独立保留。

### 4.6 验收及开放

核对两端迁移版本、38 张表（以实际快照为准）的行数及关键表内容摘要、八班组库存件数/重量、在途、共投计划、加工产出、人员、仓位、转投及批次关系。只读验证搜索、分页、导出、追踪和打印；写操作只在隔离演练环境执行。检查四个业务服务健康、新备份 `status.json` 无异常、日志连续且能恢复；同时确认页面字体、图片和脚本在断网环境正常加载。

验收通过后，保存本次恢复结果，供后续发布和离线导出识别：

```bash
python3 - "$bundle" "$release_dir" "$data_dir" <<'PYRESULT'
import datetime, json, pathlib, sys
bundle, release, data = map(pathlib.Path, sys.argv[1:])
manifest = json.loads((bundle / 'manifest.json').read_text())
result = {'status': 'success', 'phase': 'restored-and-verified',
          'revision': manifest['revision'], 'tag': manifest['release'],
          'backup': str(data), 'images': manifest['images'],
          'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
(release / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
PYRESULT
```

所有验收通过后，设置受控的 `PUBLIC_BIND_ADDRESS`，配置内网访问地址及防火墙，再执行 `dc up -d --no-build --pull never --no-deps frontend` 开放访问。不要用开发版 Compose 开放数据库和后端端口。

切换期间旧端保持停止写入；新端一旦承接业务，不允许直接恢复旧端继续使用，避免两套账。后续程序升级仍使用服务器版 Compose，新版本应重新准备离线镜像，不能依赖本次旧镜像覆盖文件发布新代码。

## 5. 回退与日常注意事项

- **新端还没有产生业务写入**：确认停止新端应用后，可恢复旧端应用并切回访问地址。
- **新端已经产生业务写入**：不能直接启动旧库继续用。必须再次停写，备份新端数据，制定反向迁移或差异核对方案，否则新记录会丢失。
- 验收稳定前保留旧服务器、镜像和数据库备份，不立即释放服务器。
- 不运行 `docker compose down -v`、数据卷清理或手动删除 `_data` 来解决启动问题。
- 不直接复制整个 `/var/lib/docker`，不复制正在运行的 MySQL 数据文件代替一致性备份。
- 后续升级程序前备份数据；回退镜像不等于回退数据库结构。
- 如果改用指定目录挂载数据库，需要另做停机迁移，不能只修改挂载路径，否则可能启动一个空库。

参考：[Docker 生产部署](https://docs.docker.com/compose/how-tos/production/)、[Docker 数据卷](https://docs.docker.com/engine/storage/volumes/)、[MySQL 8.4 备份工具](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)。现有服务器发布记录见 [服务器部署说明](server-deployment.md)。
