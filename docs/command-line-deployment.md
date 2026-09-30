# 命令行发布

在 **Mac 的项目目录**执行，升级现有 `122.200.93.68` 服务器。不是新服务器安装脚本，不自动推送 GitHub。

## 两条命令

先提交要发布的代码（包括本部署脚本），确保 `git status --short` 为空。脚本只上传本地 **Git HEAD**，不会上传未提交的代码、本地数据库、`.env` 或 SSH 私钥。

预览版本和目标，不连接服务器：

```bash
bash scripts/deploy.sh
```

默认使用当前 Mac 用户桌面的 `developer.pem`（本机为 `/Users/zhangsen/Desktop/developer.pem`）。预览会显示实际密钥路径，只显示路径，不读取或输出私钥内容。

确认后发布，无需每次填写私钥参数：

```bash
bash scripts/deploy.sh --apply
```

需要换一把私钥时，用 `--identity` 覆盖默认值；不要把密码写进命令：

```bash
bash scripts/deploy.sh --apply --identity /Users/你的用户名/.ssh/你的私钥
```

SSH 和 SCP 都显式指定同一把私钥，并启用 `IdentitiesOnly=yes`；不会因忘传参数退回尝试无关的默认密钥。私钥仅用于本机认证，不上传、不写进仓库。正式发布时若文件不存在或不可读，脚本会在连接服务器前停止并提示路径；预览不要求密钥存在。带口令的私钥请先用 `ssh-add "$HOME/Desktop/developer.pem"` 加载（更换密钥时改成对应路径）。首次连接须先正常 SSH 登录，核实并保存服务器指纹；脚本不会跳过主机校验。其他已有同布局环境可用 `--host 用户@服务器 --port 22 --identity /你的私钥路径`，执行前认真核对预览目标。

## 执行前提

- Mac 有 Git、SSH、SCP、Bash；无需本机 Docker、Node 或 Python。
- 服务器有 Python 3、Docker，以及 `/opt/heatsinkrep/bin/docker-compose` 或 Docker Compose v2；SSH 账号可以 `sudo -n`，否则立即失败，不自动修改权限。
- `/opt/heatsinkrep/.env`、`current` 和现有四个健康服务已经存在，数据卷仍为 `heatsinkrep_mysql_data` / `heatsinkrep_rabbitmq_data`。
- 服务器须能取得基础镜像、npm 和 PyPI 依赖，并有足够构建/备份磁盘与内存。镜像源沿用服务器 `.env` 中的配置；构建失败时旧服务仍运行，不自动安装软件或改镜像源。
- 在维护窗口执行，告知使用者会短暂停用；先完成本地业务测试和数据库迁移演练。脚本的健康检查不代替业务验收、压力测试或备份恢复演练。

## 实际执行顺序

1. 打包已提交的源码，通过 SSH 上传；新建独立的 `releases/时间-提交号`，用发布锁禁止脚本并发执行。
2. 在服务器依次构建后端和前端；此时原服务保持运行。
3. 停止旧前端入口和后端写入，备份数据库及私密配置。校验 SQL 完成标记、gzip 完整性并生成 SHA256。
4. 使用新后端执行 `alembic upgrade head`。当前废泥功能会升级到 `20260929_0025`；不重置库存，不造演示数据。后端镜像启动自带的迁移检查保留，已到最新版本时不再改表。
5. 只更新后端和前端容器，检查网页、Nginx → API → 数据库链路及四服务健康；核对数据库和 MQ 容器未重建/重启，成功后才更新 `.env` 的两个镜像标签和 `current`。

使用已有单后端部署，不改进程数、端口、账号或业务规则。不删除旧镜像、旧源码、备份及数据卷。大版本依赖变更、数据库/MQ 升级、首次安装请另按 [迁移文档](server-migration.md) 操作。

## 结果与失败处理

服务器保留：

```text
/opt/heatsinkrep/releases/<版本>/deploy.log       构建、迁移、核验日志
/opt/heatsinkrep/releases/<版本>/result.json      success / failed / running、阶段与提交
/opt/heatsinkrep/backups/pre-<版本>/database.sql.gz
/opt/heatsinkrep/backups/pre-<版本>/database.sql.gz.sha256
/opt/heatsinkrep/backups/pre-<版本>/config.env     私密配置，不外传
/opt/heatsinkrep/backups/pre-<版本>/previous.json  原源码路径及四个镜像版本
```

发布中终端会显示阶段，详细日志在服务器受限目录。查看日志（将 `<版本>` 换成终端输出）：

```bash
ssh -i "$HOME/Desktop/developer.pem" -o IdentitiesOnly=yes ubuntu@122.200.93.68 'sudo tail -n 100 /opt/heatsinkrep/releases/<版本>/deploy.log'
ssh -i "$HOME/Desktop/developer.pem" -o IdentitiesOnly=yes ubuntu@122.200.93.68 'sudo cat /opt/heatsinkrep/releases/<版本>/result.json'
```

- 构建失败：旧应用不停止。
- 备份失败且迁移尚未开始：尝试恢复旧应用；恢复本身失败会记入日志。
- 迁移已经开始后失败：停止应用，保留数据库、备份和日志，必须人工判断兼容性；**不自动降级、不回灌旧数据库**。`0025` 的废泥审计字段尤其不能为回退而删除。
- SSH 断线或进程意外退出：命令结果不代表发布结果。先检查 `result.json`、日志和容器；`running` 不代表成功。不要直接重复发布或手动启动旧后端。
- 正常成功会清理本次上传的临时文件；失败时保留上传路径以供排查。锁随发布进程退出自动释放，不要删除锁文件绕过仍在执行的任务。

脚本检查的是服务器内部网页/API链路。成功后还应从自己的浏览器打开 [线上系统](http://122.200.93.68:8082)，确认公网入口及需要的业务页面。

## 本地脚本验证

```bash
bash -n scripts/deploy.sh
shellcheck scripts/deploy.sh
python3 -m unittest discover -s scripts/tests -p 'test_deploy.py' -v
```

测试模拟 Docker/SSH，覆盖备份失败、迁移失败、健康失败、成功切换与安全路径检查；不会连接生产或修改库存。本次仅新增脚本并做隔离验证，未执行线上发布。
