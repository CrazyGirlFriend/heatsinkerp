# 热沉物料流转管理系统

这是一期的班组间物料交接系统。它不依赖产品工艺、工单或报工：班组长手工填写流水号、物料类型、件数、重量和接收班组，并可补充原单批号、材质规格等单据信息，系统生成唯一转料批次号；接收班组扫码核对并整批确认。确认后单据永久锁定，完整轨迹按流水号查询。

每条物料独立生成一个批次号和 Code 128 条码，不再生成 CK 整单号。不同流水号、不同物料类型各自编号、分别接收，可合并打印在同一张 A4 纸上，合印不合批。原批次号不改号，历史 CK 仅保留查找关系。蓝牙扫码枪按 HID 键盘输入编号并回车，不需要摄像头、蓝牙 SDK 或厂商插件。流水号表示工件信息，批次号表示本次实际转料。详见 [独立批次与合并打印](docs/independent-material-batches.md)。

一期的权威业务口径见 [一期物料流转口径](docs/phase-1-material-transfer.md)。旧工艺、工单、报工、产量页面及后端业务接口已删除；只保留隔离的历史表定义、迁移和真实记录。当前文档入口见 [文档索引](docs/README.md)。

## 一期功能

- 首页全厂库存总览：全厂在库、内部在途与八班组库存卡片，展示件数、重量、待接收批次、在库流水号及加急数量。沿用已确认的浅白紫、设备图与玻璃卡片；业务提交成功后通过 SSE 主动更新，数字仅在实际变化时过渡。暂停只停动画，不停数据，见 [首页实时推送](docs/inventory-realtime.md)。
- 全厂数据分析单独位于 `/factory-analysis`，保留图表与分析大屏；机器人大屏位于 `/factory-live`，独立显示背景、机器人、八班组状态及首条记录联动。机器人大屏和班组台账的实时推送已上线，全厂分析页保留原更新机制；范围与发布说明见 [台账及大屏实时推送](docs/workspace-realtime.md)。
- 全局转料、流水号追踪、管理列表和只读详情的实时同步已随 `20260914T165812Z` 发布，保留筛选、页码和编辑草稿；范围及打印/选料例外见 [全站表格实时更新](docs/table-realtime.md)。
- 主系统对接配置页、流水号资料查询及权威快照入库接口已随 `20260916T015209Z` 部署；目前保持停用，尚未与真实主系统联调，入库表单和全字段整批打印仍待配套接入。对接方可直接查看 [接口规范](docs/main-system-integration.md)。
- 系统管理员维护班组和班组长账号，并可标记或取消流水号加急；班组长账号必须绑定一个有效班组。
- 管理员只读查看转料记录，不能代替班组发起、修改、作废或确认转料。
- 班组长发起转料时，转出班组由登录账号自动确定，手工填写完整转料单并选择接收班组。
- 支持八种物料类型，半成品与半成品余料分别记录；成品件数与本次交接件数、原单批号与本次转料批次号分别保存。件数和重量至少一个大于 0，允许废泥等按重量交接。转入库房须明确物料类型，可填写入库说明。
- 正式八班组独立工作台：库房、轧制、退火、研磨、线切割、雕刻、电镀、检验；库房含转废，检验含去毛刺和发货。稳定编码关联管理员班组目录，保留旧账号和记录。
- 每班组包含库存明细、待接收、出库记录、丢失记录、材质归类和数据分析。流水号台账已合并至库存明细，普通班组按流水号汇总，库房进一步按来源、类型及材质规格分组；原始批次与收发、丢失记录在详情中查看，图表单独展示。普通业务列表默认 10 条，可选 20/50/100 条并纵向滚动；单据详情与打印使用表格。当前视觉规则见 [界面一致性约定](docs/ui-style-guide.md)。
- 库房另有手工入库与入库记录：库房班组长手工填写流水号、材质、物料类型、件数、重量和入库说明，提交后直接入库，无需公司主系统或虚拟上序。已入库物料可继续分批/批量出库或登记丢失。
- 已接收批次支持单批/向同一下序批量出库和带原因的丢失登记。每条物料各有批次号和条码，下序分别核对确认；事务行锁和幂等避免超扣、重复提交及部分写入。库房库存按流水号、材质规格、类型、来源分组，出入库记录可按废屑等类型与日期筛选。
- 内部转料提交即从上序库存扣除，待接收期间单独计入在途，下序确认后入下序库存，上序不重复扣减。作废未接收单恢复上序库存；班组汇总、材质和流水号图表、机器人大屏使用同一口径。全厂持有物料为在库与内部在途之和。
- 库房可对外出库，检验可直接发货：填写外部去向，提交即扣减本班库存，再由本班组逐批确认；确认只锁定单据、不重复扣库，未确认单作废返还库存，不伪造内部下序或回流库存。
- 多批合印一份表格式汇总单，每个批次分别打印条码、流水号、资料、材质、类型、件数、重量；常规批次一张 A4，内容过多自动续页，不删减明细。
- 每次转料生成持久化的唯一批次号及 Code 128 条形码；批次只包含一个转出班组和一个接收班组。
- 待接收批次仅转出班组可修改或作废；接收班组整批确认后永久锁定，不能再覆盖原记录。
- 扫码枪输入批次号并回车即可打开详情；只有批次指定的接收班组可以确认。
- 流水追踪展示同一流水号的全部转料批次、最近一笔在途状态或最近确认位置，不强制判断工艺路线，也不把分批记录误算成唯一库存位置。
- Bearer 会话、角色与班组权限、创建及确认幂等、数据库事务和字段修改历史由后端统一维护；编辑和确认时校验单据版本。
- 转料记录支持包含、精确、前缀三种匹配方式、六个编号/材质字段选择和物料类型筛选；班组/状态/时间排序及编号查询有对应索引。迁移与真实 MySQL 验证见 [查询索引验收记录](docs/transfer-query-index-verification.md)。

## 技术结构

- `frontend/`：Vue 3、TypeScript、Vite、Vue Router、Element Plus 自定义工业主题
- 前端状态与数据：Pinia、Axios；图表与条形码：ECharts、JsBarcode
- `backend/`：FastAPI、SQLAlchemy、Alembic
- 数据库：MySQL 8.4，`utf8mb4`
- 运行入口：Nginx 托管单页应用并反向代理 FastAPI，Docker Compose 组合部署

一期业务边界见 [一期物料流转口径](docs/phase-1-material-transfer.md)，现场操作见 [一期用户使用说明](docs/phase-1-user-guide.md)，技术目录和数据流见 [前端与系统架构](docs/frontend-architecture.md)。

## 一键启动

先准备生产密码：

```bash
cp .env.example .env
```

编辑 `.env` 中的 MySQL 密码和 `SEED_ADMIN_PASSWORD`，然后启动：

```bash
docker compose up --build -d
```

系统地址：`http://localhost:8080`

后端接口文档：`http://localhost:8000/docs`

初始管理员账号由 `.env` 中的 `SEED_ADMIN_USERNAME` 和 `SEED_ADMIN_PASSWORD` 决定。未创建 `.env` 时，开发默认账号为 `admin / Admin123!`，只适合本机试用。

查看服务状态或停止：

```bash
docker compose ps
docker compose logs -f backend
docker compose down
```

MySQL 数据保存在 `mysql_data` 卷中；普通停止不会删除数据。后端容器启动时会先执行 `alembic upgrade head`。

首次配置本期八个正式班组，在迁移至当前 `20260912_0011` 后运行：

```bash
docker compose exec backend python -m app.configure_material_teams
```

脚本只补缺少的正式班组和已确认的“扎板 → 轧制”目录更名，不创建班组长、不调整旧账号绑定、不删除旧组；发现同名/编码/分类冲突会退出。旧演示脚本不是正式班组初始化入口。

台账包含升级后的新确认接收和显式库房手工入库，历史未知库存不自动推断。库房实物可逐批手工建立库存，不等待主系统对接；不能把已经确认的内部来料再手工入库一遍。手工首次交接与从库存扣减出库是不同入口；批量期初导入、对外发货结算及公司主系统接口尚未实现。测试范围见 [班组物料台账验收记录](docs/team-material-stock-test-report.md) 与 [库房手工入库验收](docs/warehouse-receipt-test-report.md)。

## 本机演示数据

本机试用使用独立 MySQL 端口 `33306`，且仅监听本机，避免影响现有数据库（需要 Docker Compose 2.24.4+）：

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.demo.yml exec backend python -m app.seed_material_transfer_showcase
```

一期演示脚本只复用已有的有效班组长和班组，不创建账号、不设置密码，也不依赖产品、工单、工艺或报工。至少三个不同班组各有一个有效班组长时，它会为流水号 `DEMO-DIRECT-FLOW-001` 建立一张已接收和一张待接收转料单；条件不足时会明确跳过。重复执行不会重复写入。

旧版工单/报工演示脚本已删除，已有历史数据不受影响。以上小示例脚本不自动建号或改绑账号。

完整八班组演示使用 `python -m app.seed_team_material_showcase`，运行前须通过环境变量 `DEMO_TEAM_PASSWORD` 提供至少 12 位密码。该脚本只在显式执行时补建八个 `demo_*` 班组长，不更改已有账号的密码或绑定；通过真实入库、出库、确认和丢失流程建立 433 条物料记录、376 个出库批次及 192 条丢失记录，完成后重跑不会覆盖后续操作。不可将该命令放进生产启动步骤。

旧业务数据清空工具 `python -m app.reset_business_data` 默认只预览计数。实际清理必须停写、备份，再加 `--apply --confirm-database <数据库名或路径> --backup-file <备份文件>`；账号、班组及条码计数器不删除。不要在未备份或未确认的数据库上执行。此次改版和数据范围见 [紧凑工作台改版记录](docs/compact-workspace-refresh.md)。

## 服务器部署与访问锁

公网服务器使用独立的 `docker-compose.server.yml`，只发布前端端口，数据库与后端不开放公网连接。设置 `SITE_ACCESS_PASSWORD` 和随机 `SITE_ACCESS_SECRET` 后，访问口令会由后端校验，验证通过后才进入账号登录页。口令不写入前端代码。

`/opt/heatsinkrep` 目录结构、启动命令、私密配置及 HTTPS 注意事项见 [服务器部署说明](docs/server-deployment.md)。

## 本地开发与测试

后端（Python 3.11+）：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements-dev.txt
PYTHONPATH=backend pytest backend/tests -q
```

前端（Node.js 22）：

```bash
cd frontend
npm ci
npm run typecheck
npm test
npm run build
```

一期已确认边界见 [一期物料流转口径](docs/phase-1-material-transfer.md)。[清理记录](docs/code-cleanup-report.md) 说明删除范围、恢复备份及验证结果；旧方案集中存放在 `docs/history/`，不作为当前实施要求。
