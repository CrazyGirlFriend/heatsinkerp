# 前端与系统架构

核对日期：2026-11-07。本文描述当前入口与依赖边界，整体验收状态见[实施计划](frontend-backend-refactor-plan.md)。早期一期范围及发布记录保留在[历史快照](history/frontend-architecture-before-20261107.md)，不作为当前功能删改依据。

## 业务范围与部署

当前系统包括库房收发与仓位、班组库存与加工、检验返工、工艺、调度与交期、流水号查询、全厂与班组概览、站内消息及系统设置。旧工单系统的历史表仍隔离保留，不等于当前工艺和加工功能被停用。

前端为 Vue 3 / TypeScript / Vite，后端为 FastAPI / SQLAlchemy / Alembic 的模块化单体。浏览器经同源 `/api` 访问后端；Nginx 提供静态页面与代理，MySQL 保存业务数据，RabbitMQ 传递已提交的变更通知。前后端独立构建和测试。

AsyncAPIRouter 将现有同步 ORM 用例放入异步 Session 的 `run_sync` 执行；整理时保持事务与行锁语义。通知恢复见[异步接口与消息队列](async-notifications.md)，部署见[服务器部署说明](server-deployment.md)。

## 前端职责

| 位置 | 职责 | 约束 |
| --- | --- | --- |
| `pages`、`router` | 页面组合、导航与权限提示 | 请求通过 services；后端独立校验权限。 |
| `components`、`composables` | 业务表单、异步交互、可复用展示 | 局部草稿留在当前作用域；丢弃过期响应，关闭时释放资源。 |
| `App*`、`Workspace*`、`components/watermelon` | 控件、列表容器、主题和动效 | 复用适配入口，避免页面复制皮肤和组件库选择逻辑。 |
| `services` | API 请求、推送连接、错误与变更事件 | 不导入 pages、components、composables、stores；通过事件通知状态层。 |
| `stores` | 跨页面会话、权限、目录、导航与消息 | Pinia 实例由 `stores/pinia.ts` 创建；不重复缓存可派生业务数据。 |
| `types`、`utils` | 契约、显示格式和纯计算 | 不反向依赖 UI 或 store；图表配色类型归入 types。 |

ESLint 检查 services、types、utils 的反向导入。加工状态、加工记录契约和流水号汇总分别归入 `processingStatus.ts`、`processingContract.ts`、`inventorySummary.ts`，已解除两组类型循环。对 307 个生产模块的静态导入／再导出扫描仍保留 `MaterialDispatchDrawer` 与 `MaterialTransferDrawer` 的相互引用，用于按用户操作打开关联单据；不是全项目零循环依赖。

### 请求与状态

- 业务 API 使用 `services/httpClient.ts`，统一账号认证、错误、请求编号和账号过期处理。
- 访问锁使用 `services/accessApi.ts` 的独立 Cookie 客户端，不附带账号认证；与业务客户端共用 `apiConfig.ts` 的 API 根路径。
- HTTP 423 和 SSE 访问过期通过 `siteAccessEvents.ts` 通知状态层。store 先锁定访问，再发出导航事件；在途旧响应不能重新解锁。store 销毁时取消订阅。
- `stores/access.ts` 保留兼容导出；新增调用使用各层实际入口，API 实现和 Pinia 实例已分开。
- `inventoryChanges.ts` 共享底层通知连接，页面用 `useLiveRefresh` 等既有机制刷新，避免每个控件新建 SSE。

### 业务入口

| 业务 | 当前入口 |
| --- | --- |
| 全厂数据分析 | `FactoryOverviewPage.vue`：运行、生产、质量、库存交接四个长页分区，复用 Dashboard 组件。 |
| 班组工作台 | `TeamWorkspacePage.vue`：依照 `teamWorkspaces.ts` 组织概览、库存、收发、加工、交期、质量、仓库和设置。 |
| 工艺、调度、业务 | `ProcessRoutesPage.vue`、`DispatchSchedulesPage.vue`、`BusinessPeoplePage.vue`。 |
| 生产排期 | `ProductionSchedulesPage.vue`、共享排期组件与 VTable 适配；缩放属于显示逻辑，完成情况来自后端。 |
| 流转查询 | `TransferBatchesPage.vue` 与 `SerialInventoryPage.vue`，复用扫码、详情和批次打印。 |
| 账户与配置 | `AccountsPage.vue`、`TeamsPage.vue`、`MainSystemConfigurationPage.vue`。 |

八个班组复用同一工作台，身份匹配稳定编码，不硬编码数据库 ID。工艺、调度、业务账号沿用既有角色导航。

### UI 与资源

已登录业务页面（含全厂分析）由 `App.vue` 提供 Watermelon 外观；登录与访问验证保留已有外观。Watermelon 是项目内 Vue 适配，没有独立 React 前端。组件使用边界见[复用清单](code-reuse-map.md)和[Watermelon 说明](../frontend/src/components/watermelon/README.md)。

ECharts / VTable 继续封装在图表组件中。刷新保留视图与筛选；卸载释放图表、订阅、定时器、观察器和异步文档资源。文件原稿与打印保持纸张配色。共享动效保留键盘操作、焦点恢复和减少动画偏好；本次整理不重新设计已确认的布局、颜色或缩放表现。

## 后端职责

| 层次 | 当前入口和整理方式 |
| --- | --- |
| HTTP 接口 | Router、Pydantic 输入校验、认证和响应；`api.py` 汇总入口。 |
| 应用服务 | 库存收发、加工、返工、排期等用例组织权限、幂等、版本、审计和事务。 |
| 业务规则 | 可独立调用的函数；`processing_rules.py` 分离普通与拆分加工策略，由服务端班组能力选择。 |
| 查询与数据访问 | `material_stock_queries.py`、`production_schedule_queries.py` 等集中列表与统计，复用 ORM 和库存余额账。 |
| 外部适配 | RabbitMQ、文档转换、外部主系统等保留独立模块与资源管理。 |

应用服务保留既有 HTTPException 错误适配和事务入口，调用方依赖的状态码、错误文案及回滚行为保持兼容。新提取的加工纯规则不依赖 FastAPI 或 ORM；请求上传、筛选参数组装及响应转换仍由 API 负责。本次采用这些明确边界，没有为统一异常名称改写所有用例，也不将当前架构描述为全项目纯领域模型。

### 已落实的边界

- 工艺详情组装进入 `process_route_documents.py`，工艺绑定进入 `process_route_binding.py`；返工与流转不再反向导入 `process_route_api.py` 的业务函数。
- 工艺列表与映射查询进入 `process_route_queries.py`，保存、发布、修订和附件写入进入 `process_route_service.py`；API 保留请求身份、上传校验及 HTTP 文件响应。
- 班组目录、仓位、初始库存、通知、统计、主系统配置等 HTTP 入口从原业务模块拆入对应 `*_api.py`；原模块的事务边界和公开业务函数保持原有调用方式。
- 绑定参加调用方事务，不独立提交；权限、批次、工艺、余额及审计行为保持一致。
- `processing_rules.py` 不导入 FastAPI、ORM 或数据库；处理器注册表选择普通或拆分规则。`processing_registration.py` 提供工厂当地日期并映射已有错误响应。
- 库存、排期保留公共查询的兼容导出；事务负责人不随函数移动改变。
- 架构测试禁止业务模块导入 HTTP 端点模块，并检查加工规则不直接依赖 HTTP/数据库。

### 事务与消息

写入用例由现有 SQLAlchemy Session 管理事务，库存余额、来源链、流转、审计及 outbox 一起提交或回滚。内层函数不自行提交；重试沿用幂等键，修改沿用版本检查，关键读取保留 MySQL 行锁。

通知在事务提交后发布，失败可重试；重复消息只触发重读，不再执行库存写入。查询和写入共用数据库，没有引入独立读库、微服务、通用仓储框架或事件溯源。工厂与策略处理真实差异，不按班组复制处理器。

顶层导入核对发现现有的 `models → stock_balances / inventory_events → models` 初始化环：模型定义末尾注册账本和 outbox 的 ORM 事件，确保维护脚本与 HTTP 写入都生效。本次没有新增顶层导入环，也没有为了消除检测结果移除这些注册；若以后改为显式启动注册，必须同时覆盖所有维护写入入口。

## 契约与业务计算

- 以 Pydantic/OpenAPI 定义和接口回归核对字段、件数、重量、尺寸、时区、状态、空值及筛选。正常 JSON 成功响应均声明具体模型；文件与 SSE 使用相应响应类型，两个保留的禁用写入口始终返回既有错误。接口清单测试防止新增无结构的 JSON 返回值。
- `api:generate` 使用 openapi-typescript 生成 `types/generated/api.d.ts`，`api:check` 防止生成结果过期。班组目录、仓位、流水号历史、加急、工艺、排期、加工和统计等类型复用生成契约。表单草稿、经过归一化的业务视图及历史可选字段继续使用明确的视图类型；不能声称全部前端类型直接等于网络响应。
- 班组／全厂库存共用 `InventoryGroupResponse` 与库存余额契约；工艺列表与详情分别建模，导入预览允许展示待核对工序，不复用写入时的发布校验。
- `team_read_response` 强制接收 Schema，在构造 `JSONResponse` 前验证数据并保留 no-store；防止框架直接响应绕过数据校验。追溯、检验、加工记录、入库附件、修改审核、概览与通知都有独立的读响应模型。
- 实际剩余库存、在途数量、加工与返工状态、滞留和交期进度由后端计算，前端负责格式与交互。已确认滞留起点为收料时刻。
- 库房入库登记实物，共投在向下序转出时建立；多个流水号份额不能重复计为多块实物库存。
- 写入失败不能伪造成功，错误、空值与加载中不能全部显示为零。更改契约时同步前端服务类型和接口测试。

## 验收

命令见[代码质量](code-quality.md)。提取前核对调用方和基线，验证权限、回滚、幂等、版本、数量重量守恒、查询开销及资源释放。随后用一个 Chrome Playwright 会话检查角色和班组流程，结束关闭任务浏览器。

SQLite 回归不替代真实 MySQL 并发验证；未执行的检查须保留为待验收。完成状态以[实施计划](frontend-backend-refactor-plan.md)为准。
