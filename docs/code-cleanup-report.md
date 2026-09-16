# 本期代码清理记录

本次按“删除已退出一期的实现、整理当前代码、不删历史数据”的确认范围执行。所有改动在本地完成，没有发布服务器、修改真实账号或删除数据库记录。

## 清理结果

前端不再保留旧工艺、工单、报工、产量页面及其服务、类型和组件；后端对应接口及工作流已经删除，不只是隐藏导航。当前保留访问锁、登录、班组/账号管理、转料单、流水追踪和班组收发台账。

| 统计范围 | 清理前文件数 | 清理后文件数 | 清理前行数 | 清理后行数 |
| --- | ---: | ---: | ---: | ---: |
| `frontend/src`（含测试） | 114 | 72 | 17,815 | 8,983 |
| `backend/app` | 27 | 26 | 7,571 | 3,408 |
| `backend/tests`（含 conftest） | 11 | 6 | 4,461 | 1,670 |
| `scripts` | 7 | 5 | 1,907 | 916 |

统计以清理前源码备份逐文件比较，不包含依赖、缓存、构建产物或数据库。前端源码行数减少约 49.6%，后端应用代码减少约 55.0%；后端文件数变化较小，是因为大文件已拆成职责明确的模块。

## 实际删除的内容

### 前端

- 旧工单、产品、工序、报工、产量页面与旧扫码入口。
- 旧 `TransferBatch` 弹窗、详情、打印、服务和类型；当前 `MaterialTransfer` 单据及 Code 128 功能保留。
- 旧工单数量汇总、工序进度、异常流水组件及无引用的旧图表组件。
- `demoData`、演示假登录/假增删改、旧接口探测回退、失效的演示构建参数。
- 全局转料页中重复实现班组工作台的分支；班组台账统一由 `TeamWorkspacePage` 承担。

删除/替换的旧模块内容共 45 项，新建班组目录服务及服务回归测试 3 个文件。当前台账测试保留并归并到 `TeamWorkspacePage.test.ts`，旧工作台重复测试不再保留。完整清单及引用分析见 [前端清理验收](../output/playwright/frontend-cleanup/cleanup-report.md)。

Vue 3、Element Plus、Pinia、Axios、ECharts 的依赖保持不变；删除旧图表实现不等于移除用户要求的技术栈。

### 后端与脚本

删除以下旧应用模块：

- `batch_workflow.py`、`transfer_batch_workflow.py`、`quantity_ledger.py`
- `team_production.py`、`warehouse.py`
- `seed_demo.py`、`seed_factory_teams.py`、`seed_factory_showcase.py`、`seed_transfer_showcase.py`

同时删除旧业务专属测试 `test_workflow.py`、`test_batch_flow.py`、`test_transfer_batches.py`、`test_seed_demo.py`、`test_seed_factory_showcase.py`、`test_seed_transfer_showcase.py`；当前转料、台账、查询和访问锁测试保留，另加 5 个清理边界/权限回归测试。

删除 `verify_server.py` 旧工单验收脚本，其通用安全 HTTP 客户端提取到 `smoke_client.py`；当前 `verify_phase1_server.py` 改用该客户端。删除生成旧工单手册的 `generate_user_manual.py`、`render_user_manual.py`，旧 Word 成品保留原样。

## 当前职责划分

- `api.py`：从 1,476 行缩至 12 行，只装配路由。
- `auth_api.py`：健康检查、登录、当前账号、注销。
- `admin_api.py`：班组与班组长账号管理。
- `material_transfer_api.py`：当前转料单接口。
- `material_stock_api.py`：纵览、库存、批量出库和丢失记录接口。
- `models.py`：本期使用的 8 个模型；公共类型放入 `model_base.py`。
- `legacy_models.py`：隔离的历史表模型，仅用于保留结构、迁移与历史引用。
- `history_protection.py`：检查旧记录是否仍引用班组，防止误删或错误修改目录。
- 前端 `teamDirectoryApi.ts`：独立获取班组目录，不再依赖旧产量服务。

公开业务路由只剩 `/api/access/*`、`/api/auth/*`、`/api/health`、`/api/team-directory`、`/api/teams`、`/api/accounts`、`/api/material-transfers*`、`/api/team-materials/*`。`/api/users` 是仍保留的轻量账号管理别名，不是旧生产模块。前端少量旧 URL 只做跳转，没有加载旧页面。

旧 `/api/products`、`/api/work-orders`、`/api/team-production`、`/api/transfer-batches` 等接口现在返回 404，并加入回归断言。

## 为什么保留历史模型和迁移

历史表有真实记录和外键引用，不能因为本期不再显示工单就删除表或重写迁移。批次号计数器也必须延续，避免复用以前打印过的条码。

- 全部 21 张业务表在清理前后的 MySQL、SQLite 方言 DDL 完全一致，包含表结构、索引和外键。
- 7 份版本迁移和 `alembic/env.py` 与备份逐字节一致，迁移版本仍为 `20260906_0007`。
- 隔离空 SQLite 库完整执行升级链，再重复 `upgrade head`，21 张业务表及版本号均正确。
- 历史产品路线仍引用班组时，删除班组/改变类别继续被拒绝，历史记录不变。

本次没有连接生产数据库；DDL 方言比较不是重新执行真实 MySQL 并发压测。既有 MySQL 专项证据见 [台账验收](team-material-stock-test-report.md) 和 [索引验收](transfer-query-index-verification.md)。旧迁移验证脚本保留，是为了保护升级兼容性，不是继续运行旧业务。

## 本次验证

- 后端完整测试：`PYTHONPATH=backend pytest backend/tests -q`，70 个用例全部通过，耗时 243.24 秒；仅有一项 Starlette/AnyIO 弃用提示。
- 新增的清理边界、历史引用、登录/注销、最后管理员、账号重绑及密码重置等 5 个回归测试单独运行全部通过。
- 前端完整测试：26 个文件、181 个用例全部通过；类型检查和生产构建通过。
- 前端生产依赖图：45 个生产文件可达，无悬空引用；75 个源码/配置/构建文件的预览隔离扫描无演示自动登录标记。
- Python 编译检查及一期验收脚本 `--help` 通过；本地、服务器两套 Compose 配置解析通过（服务器校验只用占位测试环境变量，没有发布）。
- 本地 50567 QA 后端已重启到清理后的代码，5180 前端代理下登录、班组目录、纵览/库存/出库/丢失查询全部通过，旧接口 404、班组账号管理权限 403 符合预期。重启前后 5 个账号、8 个班组、8 张转料单、2 笔出库提交、3 条丢失及 15 条单据事件数量不变；测试仅创建并注销自己的认证会话，未新增业务单据。
- 终端 Playwright 验证班组五区域、全局查询、条码详情、追踪及班组/账号管理；另验证普通 QA 登录和全新无缓存演示入口。未使用 Codex 内置浏览器。

前端完整日志、截图和命令记录保存在 [前端清理验收目录](../output/playwright/frontend-cleanup/cleanup-report.md)。后端首次回归发现新增历史引用测试使用了错误的关系属性名，修正为 `route_operations` 后该测试通过；没有修改业务逻辑规避测试。

## 文档与恢复

旧工艺需求、旧演示说明和旧工作台报告已移至 `docs/history/`；部署历史单独归档，当前部署说明改为有效命令。旧 Word 手册保留，并明确标记不适用于本期。当前入口统一为 [文档索引](README.md) 和 [一期用户使用说明](phase-1-user-guide.md)。

清理前源码备份：

`/Users/zhangsen/Documents/code/python_code/HeatSinkREP-cleanup-backup.7Isvqp/source-before-cleanup.tar.gz`

同目录 `schema-before.json` 保存清理前的两种数据库方言结构快照。该归档用于恢复删除的源码，不是数据库备份；未包含真实数据库、私密环境配置、依赖和构建缓存。

需要恢复时，先将归档解压到新的临时目录，核对目标文件后选择性恢复。不要直接覆盖整个现有项目，否则会覆盖本次及此后的有效修改。

本次不新增工艺功能、不导入期初库存、不对接公司主系统、不实现对外发货结算，也未发布线上。
