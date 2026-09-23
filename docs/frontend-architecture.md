# 前端与系统架构

本文记录当前实现的技术边界和扩展约定。业务口径以 [一期物料流转口径](phase-1-material-transfer.md) 为准，视觉与交互验收以 [前端视觉与交互改版需求](frontend-redesign.md) 为准，部署操作以 [服务器部署说明](server-deployment.md) 为准。

2026-09-23 后端已随 `20260923T110054Z` 改为异步 MySQL I/O、事务库存余额及 RabbitMQ 通知；浏览器仍使用原来的鉴权 SSE 协议。新执行链路、故障恢复和迁移要求见 [异步接口与消息队列](async-notifications.md)，不应再以旧版进程内广播/短期缓存描述当前版本。

一期是独立的班组间物料交接系统，不接产品工艺、工单、报工、产量或公司主系统出入库。旧页面、服务、组件和后端业务模块已删除，仅保留隔离的历史表定义、迁移和引用保护。删除清单及验证见 [代码清理记录](code-cleanup-report.md)。

## 1. 总体结构

系统是同源部署的前后端分离应用：

```text
浏览器
  │  Vue 3 / Vue Router / Element Plus / Pinia
  │  Axios / ECharts / JsBarcode
  ▼
Nginx :80
  ├─ /            → 前端静态文件，未知路径回退 index.html
  └─ /api/*       → FastAPI :8000
                         │  SQLAlchemy / Alembic
                         ▼
                      MySQL 8.4
```

浏览器不直接连接 FastAPI 容器或 MySQL。Nginx 提供单页应用静态资源，并把同源 `/api/` 请求反向代理到后端。前端和后端可以独立开发、构建与测试，Docker Compose 负责组合运行。

## 2. 前端技术层

### Vue 3、TypeScript 与 Vite

- 页面和组件采用 Vue 3 Composition API 与 `<script setup lang="ts">`。
- TypeScript 开启严格检查；Vite 负责开发服务器和生产构建。
- `src/main.ts` 导入全局样式并创建应用；应用实例先安装共享 Pinia，再安装 Vue Router，最后挂载。
- `src/App.vue` 负责访问锁、登录页、顶部栏、响应式侧栏、路由出口和全局提示容器，不承载工单业务计算。

### Vue Router

`src/router/index.ts` 维护页面路由、标题及访问规则：

- `/access` 和 `/login` 是公开入口。
- `/` 是独立全厂总览，使用 `FactoryOverviewPage`、`FactoryOverviewCharts` 和只读 `/api/factory-overview` 接口。浏览器 Fullscreen API 提供隐藏导航的深色大屏，保留现有登录保护。普通首页手动切页，大屏每 20 秒轮播三主题，4 秒轮显有效图表点、8 秒切换近期批次；支持暂停、锁屏及减少动态效果。`FactoryRecentBatches` 展示整批最新状态，`AnimatedMetric` 仅对真实数值变化做过渡。只在页面可见且开启自动刷新时每 60 秒取数，离开页面清理刷新/轮播计时器、动画帧、图表实例及监听。
- `/transfer-batches`、`/transfer-batches/scan` 和 `/material-trace` 是一期业务入口。
- `/team-workspaces/:teamId` 使用独立 `TeamWorkspacePage` 和共用工作台组件。分类库存、数据分析、材质归类分别由 `TeamInventory`、`TeamMaterialAnalysis`、`TeamMaterialOverview` 渲染，使用 `tab` 查询参数形成独立地址；原流水号台账已合并到库存明细，不在同一页面叠加图表和库存列表。另有待接收、出库、丢失，库房额外有入库记录。`config/teamWorkspaces.ts` 定义八个正式班组配置，通过稳定编码匹配数据库记录，不硬编码 ID，也不改管理员管理权限。分类库存的全班组统一已随 `20260918T064256Z` 发布，见 [实施说明](team-classified-inventory.md)。
- 班组和班组长设置通过 `adminOnly` 路由元数据限制管理员访问。
- 旧工艺、工单、报工和产量 URL 统一重定向到 `/transfer-batches`，不删除历史数据。
- 全局前置守卫依次校验站点访问锁、账号会话和管理员权限，并使用安全的站内重定向。
- Nginx 的 `try_files ... /index.html` 保证直接刷新嵌套路由仍由 Vue Router 接管。

前端路由限制只负责交互和导航；角色、班组、数量与状态权限仍由 FastAPI 再次校验。

班组长普通登录优先进入有效的正式绑定班组工作台，管理员默认进入全厂总览；安全的显式站内重定向优先。所有已登录用户均可从侧栏访问全厂总览。正式导航不自动追加旧演示、发货、转废或任意新建班组，旧组和账号保持原样。目录缺失或失败不能回退展示全局数据冒充工作台，切换班组需清理旧详情并丢弃迟到响应。

### Element Plus 与工业主题

Element Plus 的基础样式在 `src/main.ts` 全局加载，组件在各个 Vue 文件中按需显式导入。页面表单、筛选、按钮、表格、抽屉、对话框、反馈和状态展示统一建立在 Element Plus 组件上。

界面不是 Element Plus 默认皮肤：

- `src/styles/base.css` 定义浅色导航、紫色动作色、布局尺寸、响应式断点和项目通用组件样式。
- `src/styles/element-theme.css` 覆盖 Element Plus CSS 变量及按钮、输入框、卡片、表格、对话框等细节。
- 桌面端优先展示高密度表格，手机端转换为转料记录行和抽屉式导航。
- 焦点态、键盘操作、`aria` 标签以及 `prefers-reduced-motion` 应继续保留。

一期活动页面只使用 Element Plus 图标与项目自有视觉语言，不引入第三套组件体系。

动效节奏由 `base.css` 中的 `--motion-fast`（120ms）、`--motion-standard`（180ms）和 `--motion-panel`（240ms）统一管理。页面切换直接进入新页面并淡入；侧栏和内容区使用相同的时长与曲线；抽屉使用 Element Plus 原生头部、滚动区和底栏，操作区随抽屉一起开合。转料列表首次加载使用骨架屏，刷新时保留表格并显示局部加载状态。扫码就绪使用静态状态点，避免持续装饰动画。减少动画模式覆盖页面、组件弹层和加载效果。

### Pinia 状态层

跨页面状态使用正式 Pinia store：

| Store | 职责 |
| --- | --- |
| `useAccessStore` | 站点访问锁状态、口令校验、过期通知 |
| `useAuthStore` | Bearer 会话、当前账号、角色判断、登录与退出 |
| `useTeamDirectoryStore` | 当前会话可见的动态班组目录及刷新状态 |
| `useToastStore` | 全局轻量提示消息和自动关闭计时 |

共享 `appPinia` 在应用挂载前创建，使路由守卫也能稳定读取状态。现有 `authState`、`currentUser`、`checkSiteAccess`、`teamDirectory`、`showToast` 等 named exports 是兼容层；新增代码优先使用 `use*Store()`，解构响应式字段时使用 `storeToRefs()`。

Pinia 只保存跨路由、跨组件共享的状态。筛选草稿、弹窗开关、提交中状态等页面瞬时数据继续留在页面或组件内部，避免把 store 变成所有接口响应的全局缓存。

### Axios 请求层

业务页面不直接发网络请求，而是通过 `src/services/`：

- `httpClient.ts` 创建共享 Axios 实例，基础地址为 `/api`，启用同源凭据，并从本地会话加入 `Authorization: Bearer ...`。
- HTTP `401` 会清除失效账号会话；HTTP `423` 会通知访问锁 store 立即关闭业务界面。
- `materialTransferApi.ts` 负责一期 TL 明细列表、旧条码查询、创建、待接收明细编辑/作废及独立 TL 确认。出库批量页面使用 `/api/material-dispatches/{CK}` 完整详情与整批确认接口，不通过本页明细循环调用单条确认。
- `teamMaterialApi.ts` 负责班组纵览、来料余额、出库分组和丢失记录。服务端负责关联来源、聚合后分页与最终余量校验，前端不把本页数据当全班总量。
- `teamDirectoryApi.ts` 专门查询登录可见的班组目录，不再依赖旧工单服务。
- `adminApi.ts` 负责认证、班组和账号。
- 旧 `api.ts`、`transferBatchApi.ts`、`productionApi.ts`、`productApi.ts` 及 `demoData.ts` 已删除。正式请求不会在接口失败时自动改用内存业务数据或猜测旧接口路径。

访问口令使用 `access.ts` 中独立、轻量的 `accessHttpClient`，基础地址为 `/api/access`。它不复用认证请求客户端，因为认证客户端在收到 `423` 时反向通知访问锁；分离实例可以避免 `httpClient → access store → httpClient` 的循环依赖。两个实例都使用 Axios，访问口令不写入 localStorage。

### ECharts 与 JsBarcode

- `BarcodeCard.vue` 使用 JsBarcode 渲染真实 Code 128 SVG。批量出库只渲染整批 CK 条码，打印单联汇总单；TL 标识继续用于来源追踪及旧码兼容，不为每行重复打印。长编号容器允许横向滚动而不压缩屏幕条码。
- CK 详情必须从整批接口获取全部行，不能使用分页列表里已加载的行拼单。一次确认提交原 `revision` 和固定重试键；409 后刷新并重新核对，不能自动确认新内容。内部收料与本班组对外确认根据后端允许动作区分。
- 批量打印以 A4 单张为常规目标，长文本及多行完整续页，保留流水号、材质、类型、件数、重量和合计，不依赖裁剪或无限缩字。
- 扫码枪按 HID 键盘输入处理。扫码查询与条形码渲染是两件事：前者由输入框回车触发接口查询，后者只负责显示可扫描图形。

## 3. 前端目录职责

| 路径 | 职责 |
| --- | --- |
| `frontend/src/main.ts` | 应用装配、Pinia、Router 和全局样式 |
| `frontend/src/App.vue` | 全局壳层、访问锁/登录切换、顶部栏和侧栏 |
| `frontend/src/router/` | 路由表、导航守卫、页面标题与权限元数据 |
| `frontend/src/pages/` | 路由级页面，组织查询、表单和业务组件 |
| `frontend/src/components/` | 可复用展示与交互组件；不自行定义后端业务权限 |
| `frontend/src/stores/` | Pinia 跨页面状态与兼容导出 |
| `frontend/src/services/` | Axios 客户端、接口调用、错误转换和响应归一化 |
| `frontend/src/types/` | 转料、账号、班组等前端领域类型与纯计算 |
| `frontend/src/utils/` | 日期格式化、安全导航、展示映射等无状态工具 |
| `frontend/src/styles/` | 全局工业主题、认证页及 Element Plus 覆盖 |
| `frontend/src/**/*.test.ts` | Vitest 与 Vue Test Utils 单元/组件测试 |

## 4. 后端与数据层

FastAPI 是唯一业务写入入口：

- `backend/app/main.py` 组装应用、访问锁中间件、CORS 和 API 路由。
- `backend/app/access_gate.py` 处理站点访问口令和服务端 Cookie。
- `backend/app/api.py` 仅组装当前路由；`auth_api.py`、`admin_api.py`、`material_transfer_api.py`、`material_stock_api.py` 分别维护认证健康、班组账号、单据交接、来源台账接口。
- `backend/app/auth.py` 管理账号认证和 Bearer 会话。
- `material_transfer_workflow.py` 承载一期转料创建、修改、作废、整批确认、角色权限、锁定和幂等规则。
- `material_stock_api.py` 暴露 `/api/team-materials/{team_id}`；`material_stock.py` 承载来源批次行锁、可用量、批量出库事务、丢失、幂等、按材质纵览和服务端分组分页。
- `warehouse_receipts.py` 承载库房独立手工入库：当前库房权限、目录行锁、幂等、直接入账、原始单据审计及入库记录分页，不调用公司主系统。
- 旧 `batch_workflow.py`、`transfer_batch_workflow.py`、`quantity_ledger.py`、`team_production.py` 及对应工单演示脚本已删除；OpenAPI 不再注册旧业务接口。
- `models.py`、`schemas.py`、`serializers.py` 只承担本期模型、契约及目录/账号输出；`legacy_models.py` 单独保留历史表定义，`history_protection.py` 只读检查旧记录引用，`model_base.py` 提供共用时间与编号类型。
- `backend/alembic/` 保存数据库迁移；生产启动先执行 `alembic upgrade head`，再启动 Uvicorn。

MySQL 8.4 使用 `utf8mb4`。一期新表 `material_transfers` 独立保存流水号、转出/接收班组快照、件数、重量、状态、备注、幂等键和操作审计，不含工单或工序外键。`20260906_0005` 追加物料类型、原单批号、材质规格等 17 个可空单据字段和版本号；`material_transfer_events` 持久化操作人、时间及字段修改前后值，和业务变更同一事务提交。旧产品路线、工单、报工等表保持原样，历史单据不伪造回填。

转料权限、待接收可修改、确认后永久锁定和幂等校验必须在后端事务内完成，不能依赖前端按钮是否可见。新版前端编辑和确认发送 `expected_version`；版本冲突后刷新单据，重新核对再提交，不能自动确认新内容。完整字段和历史响应见 [接口契约](phase-1-material-transfer.md#7-转料单字段接口契约)。

一期物料类型新增 `semi_finished`，不改变旧工艺关联批次的七类契约；数据库为可空字符串，不需要新列或推断历史类型。转入 kind=warehouse 的接收方在创建及修改接收方/分类时强制要求类型，历史空类型仍可确认。`notes` 沿用为入库说明；双方班组响应的 kind 是当前目录分类，名称和编码仍为保存的单据快照。

`20260906_0006` 追加 11 项查询索引，支持班组/状态过滤后的时间排序、物料类型及编号/材质的精确和前缀查询。搜索条件由 `material_transfer_query.py` 统一构造，包含模式保留旧范围、通配符按字面转义；界面列表与状态计数共用搜索参数。详细计划和 MySQL 8.4.11 验证见 [索引验收](transfer-query-index-verification.md)。

`20260906_0007` 新增 `material_dispatches`（一次向同一下序的提交）和 `material_losses`（不可覆盖的丢失登记），转料表增加 `stock_tracked`、来源转料自引用和出库组外键。每条出库明细保留独立 TL 身份和来源，当前整批条码使用 CK。新确认来料进入台账，历史记录默认 false，不倒推期初余量。

`20260906_0008` 增加 `entry_kind`（transfer / warehouse_receipt）、来源一致性约束和库房入库时间索引。手工入库来源班组为 null，目标为库房，直接 received 且 stock_tracked；不创建虚拟班组，也不改变普通转料的真实双方要求。前端按 entry_kind 显示“库房手工入库”、入库人及入库时间，空来源仅用于展示，不成为可选班组身份；下游转料继续复用已有库存来源外键。

`20260907_0009` 增加 warehouse_outbound / inspection_shipment，外部去向和本班组出库确认字段，目标班组为 null；独立 confirm-outbound 接口不复用内部接收，完成状态 dispatched、stock_tracked=false。前端根据模式显示库房对外出库或检验发货，列表、扫码、打印、追踪和历史统一使用外部去向/确认人时间，不伪造下序或把发货显示为已接收。

`20260907_0010` 为 CK 头增加确认元数据与唯一幂等键，`material_dispatch_workflow.py` 负责完整明细查询、版本摘要和原子整批确认。新前端 `materialDispatchApi.ts`、`MaterialDispatchDrawer.vue`、`MaterialDispatchPrintSheet.vue` 分别负责接口、整批核对和单条码汇总打印，复用原有 Element Plus 组件与独立滚动布局。历史部分完成状态仍可显示，旧逐条确认接口保留兼容，但当前关联批次的确认及打印入口指向 CK 整批。

余额由已确认来料减去关联的已确认出库、待接收占用和丢失汇总得到，件数与 Decimal 重量独立计算。所有写入先锁来源来料；多来源按 ID 升序锁定。之后以 `SELECT ... FOR UPDATE` 当前读读取已发生扣减，避免 MySQL REPEATABLE READ 下幂等预查询建立的旧快照导致超扣。锁后再次检查幂等记录处理同请求同时重试。整个出库、子单、审计在同一事务，任一行失败全部回滚；作废与改单遵循相同的来源优先锁顺序。

`configure_material_teams.py` 是显式配置命令，不在读取目录时隐式写数据库。它补齐八个稳定编码，保留旧账号和班组，仅应用用户确认的目录更名；不把班组固定解释为新的管理员禁用规则。

## 5. 主要数据流

### 访问与登录

```text
Router / App
  → useAccessStore
  → accessHttpClient
  → Nginx /api/access/*
  → FastAPI SiteAccessGate
  → 服务端 Cookie
  → useAuthStore
  → adminApi / shared httpClient
  → Bearer 会话
```

页面首次进入时先检查站点访问锁。访问通过后才允许展示账号登录；账号登录成功后，班组目录 store 根据访问状态和账号 token 自动刷新。访问 Cookie 和账号 Bearer 会话是两层独立保护。

### 业务查询与提交

```text
Page / Component
  → 对应 service
  → shared Axios httpClient
  → Nginx /api/*
  → FastAPI 路由与事务校验
  → SQLAlchemy
  → MySQL
  → serializer / service 归一化
  → typed page state
  → Element Plus / ECharts / JsBarcode 展示
```

页面负责选择操作和反馈状态，service 负责协议适配，后端负责最终业务判断。写入成功后重新加载转料或流水轨迹，不在前端猜测最终状态。管理员仅调用查询接口；班组长的转出班组始终由后端根据登录账号确定。

### 条形码与扫码枪

```text
系统生成转料批次号 → JsBarcode → Code 128 SVG
扫码枪 → HID 键盘字符 + Enter → 输入框 → 按批次号精确查询 → 批次详情 / 下序接料
```

同一流水号可以有多个转料批次，每个批次都有独立条码，条码值严格等于批次号。流水号用于汇总工件轨迹，不作为转料条码，也不要求先存在工单。

批次详情按后端 `allowed_actions` 决定是否展示编辑、作废和确认。待接收时发起班组可编辑或作废、指定接收班组可确认；管理员只读。确认或作废后不再有写操作。转料单使用 A4 上下双联打印页，两联均显示同一批次条码和分钟级时间。

## 6. 扩展规范

### 新增页面或组件

1. 路由级功能放在 `pages/`，可复用的业务展示放在 `components/`。
2. 优先使用 Element Plus 现有控件和项目 CSS 变量；新增颜色、间距和状态样式应先归入主题，不在多个页面复制魔法值。
3. 同时检查窄桌面与手机布局，以及键盘焦点、标签、错误提示和减少动画模式。
4. 页面组件不得通过隐藏按钮代替真正权限校验。

### 新增接口

1. 在对应 service 中增加类型化方法，页面不得直接调用 Axios。
2. 普通业务请求统一走 `httpClient`；仅站点访问锁走 `accessHttpClient`。
3. 在 service 边界归一化兼容字段，在 `types/` 中保持页面使用的领域结构稳定。
4. 保持 `401` 清账号会话、`423` 关闭访问锁、网络错误可重试的统一行为。
5. 后端同时增加 Pydantic schema、事务校验和测试；数据库结构变化必须新增 Alembic 迁移。

### 新增共享状态

1. 只有跨页面或跨组件共享的数据进入 Pinia；单页表单和筛选继续使用本地 `ref`/`computed`。
2. 使用独立 store id 和 `useXxxStore` 命名；组件中通过 `storeToRefs` 保持解构后的响应性。
3. 异步 store 需要防止旧请求覆盖新会话数据，并在退出登录或访问锁失效时同步清除敏感内容。
4. 不再新增模块级 `reactive` 单例；兼容 named exports 仅用于现有调用方的渐进迁移。

### 新增图表或条形码

- 后续若恢复统计图表，ECharts 继续采用按需模块注册和延迟加载，优先 SVG 渲染并配置无障碍能力。
- 图表必须有空数据、加载失败和容器尺寸变化处理，不能只依赖视觉颜色表达含义。
- 转料批次条形码必须保持 Code 128，编码值严格等于 `batch_no`；不要用工单号、流水号、装饰图片或二维码替代。

### 验证要求

前端变更至少运行：

```bash
cd frontend
npm run typecheck
npm test
npm run build
```

后端业务或数据结构变更还应运行后端测试，并验证 Alembic 可从当前生产版本顺序升级。涉及 Nginx 或路由的变更，需要验证直接刷新嵌套路由、`/api/health` 和静态资源缓存行为。


### 2026-09-06 选定视觉方案

当前转料页以 `docs/design/soft-workspace-selected.png`（用户选定的第二张）为视觉参考；`selected-style.png` 与 `precision-flow-selected.png` 保留为历史方案。`styles/base.css` 维护主框架、设计变量和动效，`styles/element-theme.css` 维护组件库主题，`styles/workspace.css` 统一管理页面布局与表单栅格。转料列表、扫码、追踪、管理页和登录页应用同一套规范。历史业务路由仍以需求基线规定的停用/重定向行为处理。

本地视觉演示使用独立的 `output/playwright/selected-style/preview-api.py`（仅回环地址、内存测试数据），通过 `VITE_PROXY_TARGET` 启动开发服务。它不是生产 API、认证实现或后端变更；默认前端代理与生产认证逻辑保持原配置。


### 本地预览直接进入（2026-09-06）

用户查看本地界面不需要手动登录。使用 `output/playwright/selected-style/preview-vite.mjs` 启动专用开发服务，HTML 仅在该 serve 配置下改为加载 `preview-entry.js`：它向回环地址模拟 API 建立演示会话，然后导入真实前端。普通 `frontend/vite.config.ts`、`src/main.ts`、登录 store 和正式构建均保持原有验证流程。

默认首次打开直接进入研磨班组视图；`?preview_role=admin` 直接查看管理页，`?preview_role=team` 回到班组视图。启动方式见演示目录 README。


### 侧栏与内容联动（2026-09-06）

后台框架通过一组 CSS Grid 列轨道分配侧栏与内容的宽度，侧栏收放时只过渡 `grid-template-columns`，主内容和顶栏始终占满剩余宽度。641px 以上使用该布局；640px 及以下使用独立手机导航抽屉，继续保留 inert、Escape 与焦点返回逻辑。

转料列表的容器查询限定在列表卡片内，随剩余内容宽度调整筛选与表格布局。弹窗位于查询容器之外，避免改变固定弹窗的定位参考。


### 转料详情和流向动画

`MaterialTransferDrawer.vue` 保留单笔加载、确认、编辑、作废、打印及幂等键逻辑，`MaterialTransferDetailFrame.vue` 根据列表传入的 `docked` 在页面内详情和原生抽屉之间切换。列表用 `ResizeObserver` 测量实际可用宽度，达到 1080px 时启用并排详情；打开后网格占用右侧宽度，关闭后还给列表。详情操作区固定在底部，字段可独立滚动。确认提示和请求期间锁定所选批次，防止在 A 单确认过程中切换到 B 单。

`MaterialTransferFlow.vue` 在列表和详情中复用。只有 `status === 'pending' && !locked` 时挂载 CSS 移动信号，使用现有图标库沿转出到接收方向移动。`received`、`voided` 或锁定状态无循环动画。确认接口成功返回后 `changed` 同步替换列表项与选中记录，再重查当前筛选；失败仍显示待接收，避免用动画提前宣告接收成功。减少动态效果和打印场景隐藏信号，静态流向和文字仍保留。


### 柔光工作台与状态数量

主题变量 `--workspace-bg`、`--panel-line`、`--panel-shadow` 与 `--primary` 管理页面底色、面板边缘、柔和阴影和紫色动作。紧凑导航为 104px，顶栏 80px；当前转料页标题跨列，状态筛选和列表在左侧，详情卡片在右侧。窄窗口根据列表实际容器宽度降为完整记录行，详情沿用原生抽屉。

`materialTransferApi.counts()` 沿用现有 `/material-transfers` 查询接口，以同一搜索、转出班组、接收班组参数并行请求三个状态的 `page=1&page_size=1`，读取服务端 `total`，组合出全部数量。后端接口已允许一条分页，不增加端点，不加载全部记录计算总数。计数请求独立于列表；仅状态选择和分页变化不重复获取三个计数，过滤范围或单据内容变化才刷新。过期响应通过版本号忽略，异常不伪装成零。确认和作废仍以真实接口返回的状态为准。

详情条码使用 `BarcodeCard` 的紧凑尺寸和顶部编号；打印联保留默认大尺寸、底部编号与真实 Code 128。角色权限、确认幂等键和双联打印不变。


### 单点流转动效修订

`MaterialTransferFlow.vue` 保持待接收且未锁定的显示条件，用原生进度指示点替代 MoreFilled 省略号图标。详情 3.2 秒、列表 3.8 秒，采用缓入缓出与端点停留。仅动画 transform 和 opacity，不更改单据状态或节点位置；接收成功即移除信号，减少动态效果时隐藏信号。
