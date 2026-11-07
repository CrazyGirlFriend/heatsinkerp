# 组件、业务规则与模式复用清单

核对日期：2026-11-07。本文列出现有入口，实施和验收进度见[整理计划](frontend-backend-refactor-plan.md)。新增功能先查本表；仅名称相似不代表可以合并。

## 前端入口

| 需求 | 复用位置（相对 `frontend/src`） | 调用约束 |
| --- | --- | --- |
| 按钮、输入、选择、日期、数字 | `components/AppButton.vue`、`AppInput.vue`、`AppSelect.vue`、`AppAutocomplete.vue`、`AppDatePicker.vue`、`AppNumberInput.vue` | 业务传属性、事件和插槽，主题和通用动效在组件与共享 CSS 内维护。不要逐页选择第三方实现。 |
| 列表卡片、工具栏、表格、分页 | `WorkspaceDataPanel.vue`、`WorkspaceDataToolbar.vue`、`WorkspaceTable.vue`、`WorkspacePagination.vue` | 空结果也保留布局；嵌入弹窗时明确 `fill`、`height`、`embedded`。业务声明列和行操作；不复制底层表格分支。 |
| 筛选与列设置 | `FilterDialog.vue`、`TableColumnFilter.vue`、`RecordDateFilter.vue`、`WorkspaceTools.vue` | 筛选字段来自业务，通用打开关闭、布局与样式复用；不新增全屏或仅含单项的“更多”。 |
| 弹窗、抽屉、展开、页签 | `AppDialog.vue`、`AppDrawer.vue`、`AppDisclosure.vue`、`AppTabs.vue` | 保留焦点恢复、Escape、嵌套弹窗和减少动画偏好。 |
| 提示、错误、加载、空态 | `AppAlert.vue`、`AsyncStatus.vue`、`AppSkeleton.vue`、`AppEmpty.vue`、`StatePanel.vue`、`stores/toast.ts` | 不伪造进度；首次加载和保留旧行刷新应区分；错误不能显示为零库存。 |
| 八个班组的功能组合 | `config/teamWorkspaces.ts`、`pages/TeamWorkspacePage.vue`、`TeamWorkspaceShell.vue` | 用稳定班组编码和能力配置，不复制八套工作台；服务端仍检查权限。 |
| 工作台筛选、地址栏与分页 | `composables/useTeamWorkspaceFilters.ts` | 页面组合状态，保留导航恢复与消息目标；不把一次性通知参数保存成列表筛选。 |
| 出库及排期关联 | `MaterialStockActionDialog.vue`、`composables/useStockActionSchedules.ts` | 复用出库表单；切换来源、班组或关闭后忽略旧响应。工艺、排期约束仍由后端验证。 |
| 加工登记、任务、实物状态 | `QuantityAdjustmentDialog.vue`、`ProcessingTaskFields.vue`、`ProcessingStockStatus.vue` | 普通加工和拆分加工共用入口；任务与转料使用同一清单。不要在各页重新推算加工状态。 |
| 工艺选择、执行与附件 | `PublishedProcessRoutePicker.vue`、`ProcessExecutionPanel.vue`、`SerialRouteAttachments.vue` | 选择已发布工艺；加工表单只读工艺；实际填写与查看权限分别处理。 |
| 文档预览 | `DocumentCard.vue`、`DocumentViewer.vue`、`WordDocumentPreview.vue`、`OrderDocumentPreview.vue` | 保留原稿纸张颜色；资源与过期异步请求由预览组件清理。已有类型分支足够时不新增工厂。 |
| 排期与分析图表 | `VTableScheduleTimeline.vue`、`ScheduleTaskBoard.vue`、`DashboardCard.vue`、`DashboardDonut.vue`、`useChartPalette.ts` | 图表库由适配组件管理；库存、交期进度来自 API，卸载释放实例；本次不改用户确认的样式。 |
| API 与通知 | `services/httpClient.ts`、各业务 `*Api.ts`、`inventoryChanges.ts`、`inventoryStream.ts` | 共用请求与 SSE 连接；不导入 store 或 UI，刷新读取权威业务结果。 |
| 访问锁与状态 | `services/accessApi.ts`、`siteAccessEvents.ts`、`stores/access.ts`、`stores/pinia.ts` | Cookie 访问校验与账号认证分开；状态先锁定再通知导航，销毁 store 时取消订阅。 |

表中未注明目录的 `.vue` 文件均在 `components`。Watermelon 是项目内 Vue 适配，组件关系及来源见[说明](../frontend/src/components/watermelon/README.md)。`ElForm`、`ElFormItem`、`ElTableColumn`、`ElOption`、单选等声明性原语继续使用 Element Plus，通用外观由共享样式管理；不为每个标签增加无实际用途的包装。

原生元素的保留边界：隐藏的 submit 代理负责表单键盘提交；打印组件使用适合纸张的表格；`ScheduleBatchSummary` 内的小型批次摘要属于图表详情组件，不套用带滚动、分页和加载骨架的主列表容器。它们不是业务页面自行维护的另一套通用控件。

## 后端权威来源

以下文件均相对 `backend/app`。页面需要新字段时优先扩展对应查询响应，不能另写一套库存和加工计算。

| 业务 | 复用入口 | 应保持的行为 |
| --- | --- | --- |
| 库存余额、候选来源与锁 | `material_stock.py`、`material_stock_queries.py` | 实际剩余与在途分别统计；写入路径保留当前读和 MySQL 锁，列表查询不替代写入校验。 |
| 按班组／流水号查询 | `warehouse_inventory.py`、`serial_inventory.py`、`processing_records.py` | 加工状态、工序、返工轮次不同的实物不能合并成一行；来源选择与列表分组保持一致。 |
| 滞留 | `inventory_age.py` | 按已确认的收料时刻计算；不改为最后更新或加工时间。 |
| 入库、转出、签收 | `warehouse_receipts.py`、`material_dispatch_workflow.py`、`material_transfer_workflow.py` | 入库登记实物，共投在出库建立；权限、幂等、版本、审计与库存变化同事务。 |
| 普通／拆分加工 | `processing_registration.py`、`processing_rules.py`、`quantity_adjustments.py`、`processing_outputs.py` | 规则计算与持久化分开；服务端班组能力选择策略，保留历史兼容请求和数量重量校验。 |
| 工艺绑定与详情组装 | `process_route_binding.py`、`process_route_documents.py` | 参与调用方事务，业务模块不反向调用 HTTP API 模块。 |
| 工艺查询与写入 | `process_route_queries.py`、`process_route_service.py` | 列表查询与保存／发布／修订分开，保持版本冲突、权限、审计和原事务提交位置。 |
| 读响应与前端类型 | `read_schemas.py`、`inventory_read_schemas.py`、`process_route_read_schemas.py` 等；前端 `types/generated/api.d.ts` | 从 OpenAPI 生成，校验数量、重量与空值；`JSONResponse` 路径使用带 schema 的共享响应适配器。 |
| 返工与质量 | `inspections.py`、`rework.py`、`rework_routes.py`、`rework_rounds.py` | 保留原加工记录、工序和轮次关联，区分正常工艺与重复返工。 |
| 排期、批次与完成情况 | `production_schedules.py`、`production_schedule_queries.py`、`schedule_batches.py`、`schedule_permissions.py` | 真实收发与加工记录决定进度；与当前时刻有关的状态仍由原服务计算。 |
| 全厂／班组统计 | `factory_dashboard.py`、`team_dashboard.py`、`processing_statistics.py` | 复用库存账和加工统计，明确班组、时段、件数／重量；不在前端累加不完整分页冒充全量。 |
| 通知与外部服务 | `inventory_events.py`、`notification_queue.py`、`notification_api.py` | outbox 与业务同事务；重复消息只使读模型刷新，不重复扣料。 |

## 已选择的模式与迁移边界

| 问题 | 采用方式 | 本次落实与验证 |
| --- | --- | --- |
| 库存、排期模块同时承担复杂查询与写入 | 查询职责分离 | 提取查询模块，保留公开调用兼容入口；库存锁和写入事务保持原处。不是独立读库或完整 CQRS 改造。 |
| 工艺绑定、详情组装位于 API，其他业务反向导入 | 应用服务与序列化适配 | 移动 4 个函数，保留函数体及调用事务；接口、返工回归验证，架构测试阻止反向导入。 |
| 普通与拆分加工规则不同，但共享入账流程 | 函数策略与注册表 | `PROCESSING_STRATEGIES` 按服务端能力选择；不添加班组子类或新的事务框架。纯规则测试覆盖数量、重量、日期与非法模式，集成测试验证产出和账目。 |
| 访问请求位于 store，底层 HTTP/SSE 又导入 store | 服务适配与事件通知 | 提取 Cookie 客户端和状态事件；共享 Pinia 单独初始化。测试覆盖过期、在途响应、错误映射和订阅释放。 |
| 工艺选择器自行选择两套表格 | UI 适配器 | 使用既有 `WorkspaceTable`，保持高度、列、分页和查询行为。删除该组件的重复实现选择，兼容入口仍供其他历史调用使用。 |
| 多个班组页面与外部资源生命周期 | 组合、配置与现有资源适配 | 继续复用共享工作台、图表和预览组件；没有为形式统一新增空包装。完整浏览器与性能验收单独记录。 |

## 自动检查与兼容边界

- `backend/tests/test_architecture_boundaries.py` 检查业务反向导入 API、加工规则直接依赖 HTTP/ORM；不是完整循环依赖分析器。
- `frontend/eslint.config.mjs` 限制 services、utils、types 反向导入状态和 UI；测试文件可以跨层组合验证。
- 旧公共导出暂保留，只有所有调用与测试迁移并确认外部兼容要求后才删除。
- 既有应用服务保留 HTTPException 兼容适配，纯加工规则与 HTTP／ORM 分离。正常 JSON 成功接口均已建模，文件、SSE 和禁用写入口单独处理；接口清单测试和生成类型差异检查共同约束契约。
- 前端生成网络契约与表单／显示视图分开；历史字段归一化留在 API service，不能用 `any` 或手写同名网络模型回避契约变化。加工状态、加工契约和流水号汇总类型的循环引用已解除。
- 已确认无生产入口的 `ProductionScheduleOverview`、`ProductionScheduleGantt`、`ProductionScheduleTimeline` 及其专用条形／库存概览组件已清理；当前入口为 `ScheduleTaskBoard` 和 `VTableScheduleTimeline`。共享日期、批次、颜色与进度计算仍供当前页面使用。
- 全量回归、真实 MySQL 并发、浏览器角色流程、查询性能和资源释放的完成状态统一记录在[实施计划](frontend-backend-refactor-plan.md)，不以模块搬移替代验收。
