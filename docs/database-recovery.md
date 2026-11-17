# 数据库持续备份与恢复

## 2026-11-17 结构精简

后续迁移 `20261117_0075` 将旧工单体系的 13 张表合并为一张只读 `legacy_records`，当前应用模型进一步从 62 张减至 **50 张**（49 张现用业务/基础表、1 张历史归档表；另有 Alembic 版本表）。原表名和原记录 ID 组成主键，原字段全部保留在 JSON 中；精确小数以字符串保存，日期时间以 ISO 字符串保存。迁移逐批复制、逐条比对，全部核对通过后才按依赖顺序删除旧表。已存在的归档与源数据不一致、仍有现用表引用旧表时拒绝删除；重复执行不会重复归档。

旧工单、产品、工序、报工、耗料、签收、转料单和明细、异常、打印、操作历史、外部库存同步的旧记录均归入该表。班组删除/改类保护改为检查归档中的原班组引用；业务清理脚本保留归档内容。旧 ORM 及其关系加载代码已移除，旧版本建表定义仅保存在 `backend/migration_support`，用于全新安装经过历史迁移链，不加载进业务程序。生产镜像的两种构建入口均包含该迁移依赖。

验证：相关后端回归覆盖 129 项，包括业务收发、共同发货与逐批进度、班组目录/设备、归档和迁移。SQLite 验证跨 500 条分页的逐字段归档、重复升级、冲突及现用引用阻断；9 种历史班组引用逐一验证。独立 MySQL 8.4 实例从 `0073` 带数据升级至最新版本，核对全部历史归档、现用业务数据和联系人关系，并完成空库全链升级，确认最终为 50 张应用表。临时容器和网络已清理。

全部 1558 项后端测试可收集，未执行整个测试集。Python 全范围静态/格式检查、前端相关 55 项组件测试、ESLint / Prettier、API 契约、类型检查及生产构建通过。本轮未提交、推送、部署，也未修改线上数据库。

### 第一阶段：停用消息与重复联系人

迁移 `20261117_0074` 接续 `20261115_0073`，应用模型中的表从 71 张减为 62 张。当前为本地代码和迁移准备，尚未提交或在正式库执行。

- 删除已停用消息中心的 `schedule_notices`、`schedule_notice_reads`、`quality_notices`、`quality_notice_reads`、`rework_notices`、`rework_notice_reads`、`transfer_amendment_notices`、`transfer_amendment_notice_reads`。
- 删除旧全厂看板使用的 `serial_delivery_plans`。现用排期仍由 `production_schedule_tasks`、`production_schedules` 和分批表记录；不把旧的流水号总计划分摊或覆盖到现用排期。
- 排期业务人员统一存入 `production_schedule_task_people`。先补齐旧 `business_person_id` 中尚未建立的关联，再删除该字段及其外键和索引。已停用人员、已有多人关联均保留；重复执行不会重复插入。接口的单人兼容字段由关联表计算，不再重复存储。
- 删除 `production_schedule_tasks.locked_at`。订单锁定功能已撤下，取消时间、修改版本和操作历史继续保留。

库存余额、转料与发货明细、检验和返工事实、工艺原件、业务审计以及自动刷新的 `notification_outbox` 均保留。同一流水号的各排期批次仍独立关联发货数量。第一阶段保留的旧工单表已在上述第二阶段统一归档，历史引用保护继续保留；班组员工、设备、任务等目录仍有不同的业务身份和引用。

部署继续使用 `scripts/deploy_server.py` 的停写、完整备份、校验备份、单实例迁移流程。旧消息和旧交付计划只在迁移前备份中保留；迁移不可通过空表重建伪装成无损降级。回退应先停写并核对新产生的业务，再恢复对应备份和程序版本。SQLite 演练如启用了外键，需要先停写并关闭外键检查以重建任务表，完成后执行 `foreign_key_check`；迁移会拒绝在启用外键时重建，防止级联删除任务关联。

验证：84 项业务回归、12 项迁移检查和 16 项业务清理工具测试通过；迁移最终调整后另重跑了 4 项专门用例。SQLite 覆盖联系人补齐、重复升级、外键与完整性检查及拒绝危险重建。独立 MySQL 8.4 临时实例从 `0073` 升级，带数据验证 9 张旧表删除、联系人合并及其他业务表记录不变，并完成空库全链升级；临时容器和网络已清理。API 类型契约检查、Ruff 检查与格式检查通过；全部 1546 项后端测试可正常收集，本轮未运行整个后端测试集。

## 持续备份配置

2026-10-12 在现有服务器启用。当前是**同机恢复准备**，不是独立备库、自动故障切换或异地容灾。尚未配置站外存储和外部告警通道。

## 当前配置

- 主库：MySQL 8.4，ROW 二进制日志，`sync_binlog=1`、`innodb_flush_log_at_trx_commit=1`，源日志保留 30 天；本次未重启或修改主库持久化配置。
- `/opt/heatsinkrep/backups/continuous/`：私有备份目录，权限 700。
- `full-<UTC时间>/database.sql.gz`：每天北京时间 03:10（最多随机延后两分钟）执行一致性全备，包含数据库结构、数据、触发器、事件、存储过程；同步保存私密配置、SHA256、程序版本和日志坐标。
- `binlogs/`：MySQL 8.4.11 `mysqlbinlog --raw --stop-never` 持续拉取变更，断线自动重连；恢复后从最后一个文件开头重新读取，覆盖未完成尾部。
- 保留最近 7 天全备，并额外保留窗口前最近一份作为恢复起点；日志保留至最早保留全备所需文件。初次启用只能从首份全备开始恢复，不能追溯启用前任意时刻。
- 清理只处理本功能的已完成全备和过期归档，不删除发布备份或人工数据修复备份。成功生成、检查新全备后才执行保留策略；校验异常不删旧备份。
- 每分钟检查全备年龄、归档连续性、采样日志位置、归档进程与可用空间，并将归档落盘。状态写在 `status.json`，异常使 systemd 检查任务失败。**这不是已发送的短信/邮件告警。**
- 全备与发布共用 `.deploy.lock`，避免迁移期间生成不一致备份；冲突或失败后 15 分钟重试。InnoDB 的在线全备开始时短暂获取全局读锁，不停用业务应用。
- 归档账号只拥有复制读取权限，并要求 TLS；客户端凭据放在 `/opt/heatsinkrep/backup-client.cnf`（600），不写进 Git、命令参数或日志。
- 每次全备不足 10 GiB 空闲空间会拒绝启动；健康检查也提示空间不足。持续归档本身仍需运维关注磁盘容量，不能把检查文件当作有人值守。

源码：`scripts/database_backup.py`、`scripts/systemd/heatsinkrep-backup-*`。MySQL 精简镜像缺少日志工具，`scripts/backup/build-client.sh` 从官方仓库获取与服务器匹配的客户端 RPM，在隔离容器中验证官方签名后提取工具。镜像 ID 保存在 `/opt/heatsinkrep/backup-client-image`，不升级现有数据库。

## 首次安装

在目标 Linux 服务器的完整源码目录中运行（已有 `/opt/heatsinkrep` 应用和 Docker 网络）：

```bash
sudo bash scripts/backup/build-client.sh
sudo python3 scripts/install_database_backup.py --apply
```

内网迁移时，使用程序包内已导入的同版本客户端镜像：`sudo python3 migration-tools/install_database_backup.py --apply --client-image <镜像ID>`。该入口不联网，并检查客户端版本；目标不得已有归档凭据或恢复链。不要复制旧 `backup-client.cnf`，业务 SQL 不包含旧 MySQL 归档账号。完整步骤见 [离线迁移](server-migration.md#45-离线建立新服务器的持续备份链)。

安装器创建专用归档账号、保存私密连接文件、生成首份完整备份，再启用归档和定时器。数据库主机 UUID 改变时，先保全旧目录、人工建立新的恢复链，不能复用旧文件名覆盖已有日志。

## 运维命令

以下命令在服务器上运行，不输出私密配置：

```bash
sudo python3 /opt/heatsinkrep/bin/database_backup.py check
sudo systemctl list-timers 'heatsinkrep-backup-*'
sudo systemctl status heatsinkrep-backup-stream.service
sudo journalctl -u heatsinkrep-backup-check.service -n 20
sudo python3 /opt/heatsinkrep/bin/database_backup.py full
```

失败不能仅凭服务 `active` 判断可恢复：必须检查 `status.json` 没有问题、全备时间有效、所需日志连续且能通过恢复演练。主库重建导致 UUID 变化或日志提前清理时，归档会拒绝无声跳过缺口，需要先隔离旧归档，再建立新的全备恢复链。

## 恢复步骤

1. **先恢复到隔离数据库**，不要将 SQL 管道直接指向线上 `heatsinkrep-db-1`。固定所选备份与日志副本，核对全备 SHA256，并执行 `gzip -t`。
2. 从 `manifest.json` 读取 `binlog.file`、`binlog.position`、数据库版本和程序版本。目标时刻必须晚于这份全备的一致性快照；若是误删，选在误删之前的全备。
3. 创建同版本 MySQL，使用独立数据卷、私密测试密码、无公开端口。解压 `database.sql.gz` 导入这台隔离库。完整恢复时不要启动连接它的应用、消息消费或定时任务。
4. 按日志编号顺序将从起点文件到目标文件的**全部连续文件**一次传给 `mysqlbinlog --verify-binlog-checksum --disable-log-bin --start-position=<起点> --stop-position=<目标提交边界> ...`，输出交给隔离库 `mysql`。起点仅作用于第一个文件，终点仅作用于最后一个文件。不要逐文件拆成独立回放进程，也不要使用 `--force` 跳过错误。
5. 在恢复副本中核对迁移版本、关键表、库存和批次关系。针对误删，优先提取指定业务链进行审核恢复，避免覆盖备份以后新增的正常收发。
6. 只有确认整库切换确有必要，才另安排停写、再备份当前主库、处理待发消息和切换；本备份脚本没有自动覆盖生产库的恢复入口。

本次演练记录见 [容量与备份检查](capacity-backup-audit-20261012.md)。持续归档有传输和落盘延迟，不承诺零数据丢失；同一磁盘或整机损坏可能同时丢失主库和备份。新增独立服务器后，应再增加副本和异地版本化备份；副本会同步误删，不能替代恢复窗口。

官方依据：[MySQL 持续日志备份](https://dev.mysql.com/doc/refman/8.4/en/mysqlbinlog-backup.html)、[一致性全备](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)、[时间点恢复](https://dev.mysql.com/doc/refman/8.4/en/point-in-time-recovery.html)。
