# 新服务器部署与整套系统迁移

适用项目：热沉物料流转管理系统（HeatSinkERP）。本文是操作手册，不表示已执行迁移，也不表示待发布版本已经上线。

## 1. 先区分两种情况

| 目的 | 使用哪一节 | 原有数据 |
| --- | --- | --- |
| 在新服务器安装一套空系统 | 第 3 节 | 不包含旧账号、库存、转料记录 |
| 把现有系统完整搬到新服务器 | 第 4 节 | 备份、恢复后保留 |

迁移现有系统时，不要同时升级程序、MySQL 或数据库结构。先搬迁实际运行的同一版本，验收后再单独升级。GitHub 中只有代码和示例配置，没有业务数据库、实际密码或密钥。

## 2. 文件和数据分别放在哪里

| 内容 | 当前服务器位置 | 迁移方法 |
| --- | --- | --- |
| 各版本代码及发布文件 | `/opt/heatsinkrep/releases/` | 带走与运行镜像配套的源码目录 |
| 当前版本入口 | `/opt/heatsinkrep/current` | 新服务器重新建立软链接 |
| 密码、访问锁、签名及加密密钥 | `/opt/heatsinkrep/.env` | 安全复制，权限设为 `600` |
| 数据库备份 | `/opt/heatsinkrep/backups/` | 保留一份异机备份 |
| Docker 镜像存储 | `/var/lib/docker/` 下，由 Docker 分层管理 | 使用 `docker image save/load`，不要直接复制整个 Docker 目录 |
| MySQL 实际数据 | `/var/lib/docker/volumes/heatsinkrep_mysql_data/_data/` | 本手册使用 SQL 导出与恢复，不复制运行中的数据文件 |

数据库数据卷由 Compose 中的 `mysql_data` 定义自动创建。项目名固定为 `heatsinkrep` 时，实际卷名为 `heatsinkrep_mysql_data`，挂到数据库容器的 `/var/lib/mysql`。不必手动创建 `_data` 文件夹；新机器的实际磁盘位置以 `docker volume inspect heatsinkrep_mysql_data` 为准。

数据卷独立于容器，但仍在本机硬盘，不是云备份。更换服务器不会自动搬走数据。

以下命令在 Linux 服务器的 **Bash、root 管理会话**中分段执行（可先运行 `sudo -i`）。它们不是自动化一键脚本，不要整篇一次粘贴。命令报错时立即停下，不要跳过校验继续启动业务。

新服务器须安装 Git、Docker Engine、Docker Compose v2；先检查 `docker version`、`docker compose version`。镜像搬迁要求新旧 CPU 架构兼容。跨架构时需要为目标平台重新构建并单独验证，不能直接套用本手册的镜像导入步骤。

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

确认三个服务均为 `healthy`。首次准备八个正式班组：

```bash
dc exec -T backend python -m app.configure_material_teams
ln -s /opt/heatsinkrep/releases/initial /opt/heatsinkrep/current
```

班组初始化只补正式班组，不生成库存或班组长账号。登录后由管理员设置班组长。

只开放需要的网页端口及受限 SSH 入口，不公开 MySQL `3306` 或后端 `8000`。访问 `http://新服务器IP:8082`，先输入访问口令，再用 `admin` 和设置的初始密码登录。正式使用前配置域名、HTTPS、反向代理及相应 Cookie/来源设置。

## 4. 现有系统完整迁移

### 4.1 先演练，不直接切换

先用一份备份在隔离的新环境恢复、核对。新站点暂不向用户开放，也不要在演练库中录入正式数据。

正式切换必须重新停写并生成最终备份，不能用几小时前的演练备份直接上线。下面旧服务器命令从停写开始，会造成当前站点短暂停用，应安排好时间窗口。

### 4.2 在旧服务器备份

确认当前目录和运行镜像。源码目录必须与镜像配套，不能拿待发布目录替代当前目录。

```bash
set -euo pipefail
umask 077
source_dir=$(readlink -f /opt/heatsinkrep/current)
migration_dir="/opt/heatsinkrep/backups/migration-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$migration_dir"
dc() {
  docker compose --env-file /opt/heatsinkrep/.env -p heatsinkrep \
    -f "$source_dir/docker-compose.server.yml" "$@"
}
backend_image=$(docker inspect heatsinkrep-backend-1 --format '{{.Config.Image}}')
frontend_image=$(docker inspect heatsinkrep-frontend-1 --format '{{.Config.Image}}')
mysql_image=$(docker inspect heatsinkrep-db-1 --format '{{.Config.Image}}')
docker inspect heatsinkrep-backend-1 heatsinkrep-frontend-1 heatsinkrep-db-1 \
  --format '{{.Name}} {{.Config.Image}} {{.Image}}' > "$migration_dir/images.txt"
cp -p /opt/heatsinkrep/.env "$migration_dir/server.env"

# 阻止新业务写入，数据库继续运行以便导出。
dc stop frontend backend
dc exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -u root --single-transaction --routines --triggers --events --set-gtid-purged=OFF --no-tablespaces "$MYSQL_DATABASE"' \
  | gzip > "$migration_dir/database.sql.gz"
gzip -t "$migration_dir/database.sql.gz"

docker image save "$backend_image" "$frontend_image" "$mysql_image" \
  | gzip > "$migration_dir/images.tar.gz"
tar --exclude=.env --exclude='*.pem' --exclude='*.key' \
  --exclude=node_modules --exclude=__pycache__ \
  -czf "$migration_dir/source.tar.gz" -C "$source_dir" \
  backend frontend docker-compose.server.yml README.md
cd "$migration_dir"
sha256sum database.sql.gz images.tar.gz source.tar.gz server.env images.txt > SHA256SUMS
printf '迁移包目录：%s\n' "$migration_dir"
```

备份期间也不能从其他通道直接写数据库或执行结构变更。口令由容器环境传给数据库工具，不在命令中手写真实密码。

通过 SSH/SCP/SFTP 把整个迁移包安全传到新服务器的 `/opt/heatsinkrep/migration-bundle/`，限制目录权限为 `700`。包中有真实业务数据和密钥，禁止提交到 Git、放公开下载地址或发送到公共聊天。

导出或传输失败时，保留旧数据，确认新端尚未承接写入后可在旧端执行 `dc up -d --no-build --no-deps backend frontend` 恢复原服务；不要删除旧数据卷。

### 4.3 在新服务器准备同版本程序

以下仅用于没有本项目现存数据的新目标服务器。先核实没有 `heatsinkrep_mysql_data` 卷及同名容器；若已存在，停止操作，调查它属于谁，不能删除后继续。

```bash
set -euo pipefail
umask 077
cd /opt/heatsinkrep/migration-bundle
sha256sum -c SHA256SUMS
gzip -t database.sql.gz images.tar.gz source.tar.gz
if docker volume inspect heatsinkrep_mysql_data >/dev/null 2>&1; then
  printf '%s\n' '目标服务器已有本项目数据卷，停止恢复，请先核实。'
  exit 1
fi
test -z "$(docker ps -aq --filter label=com.docker.compose.project=heatsinkrep)"
test ! -e /opt/heatsinkrep/.env
test ! -e /opt/heatsinkrep/releases/migrated
mkdir -p /opt/heatsinkrep/releases/migrated
tar -xzf source.tar.gz -C /opt/heatsinkrep/releases/migrated
gzip -dc images.tar.gz | docker image load
cp server.env /opt/heatsinkrep/.env
chmod 600 /opt/heatsinkrep/.env
nano /opt/heatsinkrep/.env
```

在新 `.env` 中只调整新站点的地址、端口、HTTPS 等环境差异。确保 `RELEASE_TAG`、`FRONTEND_RELEASE_TAG`、`MYSQL_IMAGE` 与 `images.txt` 中三个镜像引用一致；前后端标签可能不同，不要强行设成同一个。

数据库名、应用账号及密码要与恢复方案保持一致。签名密钥和已使用的 `MAIN_SYSTEM_CONFIG_KEY` 必须保留原值；丢失加密密钥会导致已有主系统令牌无法解密。恢复已有账号后，不能靠修改 `SEED_ADMIN_PASSWORD` 来重设其密码。

### 4.4 先恢复数据库，再启动应用

```bash
dc() {
  docker compose --env-file /opt/heatsinkrep/.env -p heatsinkrep \
    -f /opt/heatsinkrep/releases/migrated/docker-compose.server.yml "$@"
}
dc config --quiet
dc up -d --no-build --pull never db
dc ps
```

等数据库显示 `healthy` 后再执行下一段。先检查目标业务数据库没有表；如果检查失败，说明不是空库，禁止直接覆盖恢复。

```bash
test "$(dc exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()" "$MYSQL_DATABASE"')" = 0
cd /opt/heatsinkrep/migration-bundle
gzip -dc database.sql.gz \
  | dc exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -u root "$MYSQL_DATABASE"'
dc exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root -e "SELECT version_num FROM alembic_version; SHOW TABLES;" "$MYSQL_DATABASE"'
```

这里不恢复旧服务器整个 MySQL 系统库；业务库导入新数据卷，数据库连接账号由新 MySQL 容器按 `.env` 初始化。应用中的管理员、班组长和会话则随业务库恢复。

确认导入成功、数据库迁移版本与源端一致，然后启动**已导入的同版本镜像**，不要重新构建最新代码：

```bash
dc up -d --no-build --pull never backend frontend
dc ps
ln -s /opt/heatsinkrep/releases/migrated /opt/heatsinkrep/current
```

不要对恢复出来的现有系统重复运行演示数据导入或清库脚本。

### 4.5 核验通过后再开放

至少核对以下项目，并记录新旧两端结果：

- 表结构/迁移版本、业务表行数及关键记录；数据要求高时再比较逐表内容摘要。
- 账号和八班组绑定；管理员、班组长的权限及访问锁。
- 各班组库存件数、重量、内部在途数量，与源端最终备份前一致。
- 流水号、批次、出库、丢失、加急记录和条码计数器，不能只核对首页合计。
- 页面、条码、打印预览、机器人及分析大屏、SSE 实时连接。
- 已配置的主系统对接还需检查新出口 IP 是否在对方白名单中，不擅自修改业务数据测试。

验收先使用只读查询。若要实际测试出入库，使用隔离演练环境，不能为了测试随意新增正式库存。登录验证可能新增会话记录，应与业务数据变化区分。

使用 IP 访问时通知用户新地址；使用域名时调整解析和证书/代理配置。切换期间旧端保持停止写入，防止旧书签或 DNS 缓存访问旧站后形成两套账。

## 5. 回退与日常注意事项

- **新端还没有产生业务写入**：确认停止新端应用后，可恢复旧端应用并切回访问地址。
- **新端已经产生业务写入**：不能直接启动旧库继续用。必须再次停写，备份新端数据，制定反向迁移或差异核对方案，否则新记录会丢失。
- 验收稳定前保留旧服务器、镜像和数据库备份，不立即释放服务器。
- 不运行 `docker compose down -v`、数据卷清理或手动删除 `_data` 来解决启动问题。
- 不直接复制整个 `/var/lib/docker`，不复制正在运行的 MySQL 数据文件代替一致性备份。
- 后续升级程序前备份数据；回退镜像不等于回退数据库结构。
- 如果改用指定目录挂载数据库，需要另做停机迁移，不能只修改挂载路径，否则可能启动一个空库。

参考：[Docker 生产部署](https://docs.docker.com/compose/how-tos/production/)、[Docker 数据卷](https://docs.docker.com/engine/storage/volumes/)、[MySQL 8.4 备份工具](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)。现有服务器发布记录见 [服务器部署说明](server-deployment.md)。
