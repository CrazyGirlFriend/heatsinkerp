# Watermelon Vue 组件

业务页面统一使用这套 Vue 组件和系统明暗主题，不启动独立 React 前端。全厂总览暂时保留原页面与图表设计。

| 组件                              | 用途                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| WatermelonDataTable               | DataTable 11 的舒展行距、细横线与明暗主题；透传 Element Plus 的列宽、固定列等属性；`fill` 撑满容器，`embedded` 适用于单层数据卡片，列通过插槽定义 |
| WatermelonDataToolbar             | 搜索、刷新和工具插槽                                                                                                                              |
| WatermelonFilter / Segmented      | 弹出筛选、分段切换，支持键盘和减少动画设置                                                                                                        |
| WatermelonDialog                  | 原生模态窗，固定标题与底部操作、内容滚动、Escape 和焦点恢复                                                                                       |
| WatermelonButton / Switch / Badge | 操作按钮、开关、状态标识                                                                                                                          |
| WatermelonPagination              | 页码、总页数、每页 10/20/50/100 条；`current-change` / `size-change` 事件                                                                         |
| WatermelonWarehouseToolbar        | 用通用组件组合库存筛选与仓位操作                                                                                                                  |

这是参考 Watermelon 源码的 Vue 适配，不是官方 Vue 包，来源与 MIT 许可见 [NOTICE.md](./NOTICE.md)。
`WarehouseManagement.vue` 统一展示仓位与未分配物料，流水号、分配状态独立成列；空仓位仍保留。
`WarehousePlacementDialog.vue` 复用安排仓位表单与并发版本校验。
`warehouseCatalog.ts` 拼接现有两个分页接口的当前窗口，不一次加载全库；未分配行只显示未放入仓位的数量。
仓库页面不提供全屏操作；班组设置统一从侧栏各班组的三级菜单进入。
列表默认每页 20 条，切换条数回到第一页；没有可批量出库的未分配物料时不显示勾选列。
组件不请求业务接口、不持有业务副本。已移除旧的重复试用页面。
`watermelon.css` 作用于 `.wm-scope`、本目录弹窗及启用主题的应用外壳。使用 `prefers-color-scheme` 跟随系统明暗设置；侧栏只调整配色，保留原菜单结构。

DataTable 参考官方 DataTable 11：48px 表头、54px 基准行高、上下 14px 留白、14px 正文，只保留细横线。
仓库查询、列表和分页放在一张 12px 圆角卡片中，空列表也撑满可用区域。分页保留总条数，页码居中、当前页描边，每页条数位于右侧。
状态复用无边框彩色胶囊，取消列表旧的渐变与隔行填色。
数字列右对齐并使用等宽数字；主字段按钮用 `wm-table-primary`，行操作用
`wm-table-action`，次要数值用 `wm-table-muted`，保持列表和明细表一致。

弹窗使用整体弹簧入场和独立遮罩渐显，关闭后释放内容，连续打开也能完整播放。
按钮通过 `loading` 切换为等宽进度状态，保留按钮名称并阻止重复提交；关闭动画和
按钮反馈均遵循系统“减少动态效果”。动画不增加接口等待时间。

## 工作台统一接入

`App.vue` 通过 `workspaceAppearanceKey` 为业务路由提供 `watermelon`；进入 `factory-analysis` 时切回 `glass`，并移除根节点的主题类。`TeamWorkspaceShell` 继承这一设置，也支持显式 `appearance`。`useWorkspaceAppearance` 将外观提供给所有子组件，包含 Teleport 弹窗。组件单独挂载时沿用原默认值，避免测试、独立预览与应用路由耦合。

- `WorkspaceDataPanel`、`WorkspaceDataToolbar`、`WorkspaceTable`、`WorkspacePagination` 统一转接 Watermelon 数据卡片、工具栏、表格和分页。原来的字段、固定列、查询、翻页和统计插槽继续由业务页面提供。
- 班组页头将当前位置作为视图切换入口，参考 Breadcrumb 6，复用 `WatermelonFilter` 的 `viewSwitch` 模式、浮层动画、键盘选择与待办数量；不再占用单独的页签行。单视图模块直接显示名称。`MaterialReceiptScanner` 沿用原接收人和扫码签收逻辑，统一使用主题颜色、40px 控件及 `WatermelonButton`。
- `TeamWorkspaceActions` 和 `FilterDialog` 复用 WatermelonButton；其他业务操作通过 `AppButton` 保留 Element Plus 的原生提交、图标、加载和焦点引用。`AppDialog` / `AppDrawer` 保留焦点、嵌套弹窗和事件机制，统一外壳、控件、入场/退出动画与明暗主题，并在 Watermelon 模式停止玻璃渲染器。
- `DocumentCard` 通过背景变量适配附件区；原件预览保留文档本身的纸张颜色。
- `watermelon.css` 管理颜色变量，`workspace.css` 管理共享工作台布局，`forms.css` 管理输入控件，`application.css` 负责现有管理页面、抽屉和附属控件的主题衔接。主题关闭后恢复原玻璃外观；不改变页面数据和权限。
- `WorkspacePagination` 同时支持 `v-model:current-page` / `v-model:page-size` 和 `current-change` / `size-change` / `change`。统计文案放默认插槽，合计放 `statistics` 插槽，不在组件外重复放一份总数。
- Canvas 流向图通过 `useChartPalette` 获取实际颜色，并监听系统主题；保留节点业务颜色与几何布局。文档原稿、图纸与打印内容保留纸张配色。

当前覆盖各班组库存、类型汇总、收发记录、转投、丢失、流水号历史、交期、质量、仓库管理和班组设置，以及工艺、生产排期、业务人员、系统设置、流转查询、通知和账户表单。查询、列表与分页置于一张卡片，空结果也占满可用高度；窄屏在表内横向滚动，分页留在可见区域。

## 表单与工具栏

- 库房工具栏不提供全屏或“更多”。导出、显示列、筛选及业务动作使用同一按钮组件和 40px 高度；显示列直接打开原来的列设置。
- `PublishedProcessRoutePicker` 复用数据表、搜索、按钮和分页，随所在页面切换明暗主题。查询和选择仍使用已发布工艺接口。
- `WatermelonDateInput` 参考 Schedule Date，提供带选中反馈的日期小窗；值仍为 `YYYY-MM-DD`，保留清除、键盘和日期范围限制。
- `AppNumberInput` 统一数字控件与加减按钮，透传原有最小值、最大值、精度和禁用属性。`WeightInput` 的 kg/g 换算保持原逻辑。
- `WatermelonNotice` 提供内联提示动画；入库必填错误在对应字段下持续展示，提交时定位到首个错误。顶部消息继续通过 `showToast` 调用，保留分组和关闭行为。
- `forms.css` 统一文本、下拉、数字、日期、多行输入的边框、40px 控件高度、焦点、禁用及错误状态。参考 Form 10 与 Select 21 的源码和实际预览；Teleport 下拉菜单同样适配，选中项使用轻底色和勾选标记。页面只使用现有表单组件，不逐页复制皮肤。

这些适配只在 Watermelon 外观下启用；表单校验、业务权限和保存接口由原业务组件负责。

## 公共交互组件

- `AppButton` 与 `WatermelonButton` 共用真实按钮上的按压反馈和等宽加载态；键盘提交、禁用和焦点逻辑保持原样。
- `AppInput`、`AppSelect`、`AppAutocomplete`、`AppDatePicker`、`AppPopover` 负责控件和 Teleport 菜单接入。业务页只传入原有属性、事件和插槽。日期范围保留原选择器的起止/区间高亮；窄屏双月日历纵向排列并在面板内滚动。
- `AppTabs`、`AppSwitch` 保留原生页签拦截和开关校验，增加选中条移动、内容切换和开关反馈。
- `AppAlert`、`AppMessageBox` 与 `showToast` 统一警告、错误和确认反馈。`AsyncStatus` 用于附件上传、预览和业务资料读取，不伪造上传百分比。
- `AppSkeleton` 保留自定义文档占位插槽；表格首次加载用骨架，刷新时保留已有行。`AppEmpty` / `StatePanel` 使用统一空状态和重试入口。
- `controls.css` 集中维护动效参数、日历与提示状态；系统开启减少动态效果时关闭非必要移动和脉冲动画。

验收记录见 [前端组件适配检查](../../../../docs/frontend-component-adaptation-20261104.md)。这些是项目内的 Vue 适配层，不是新增官方 Vue 依赖。
