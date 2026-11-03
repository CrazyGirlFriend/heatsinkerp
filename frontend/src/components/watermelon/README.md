# Watermelon Vue 组件

库房工作台先统一使用这套组件，其他班组暂时保留原主题。不启动独立 React 前端。

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
`watermelon.css` 作用于 `.wm-scope`、本目录弹窗与仓库页面外壳。使用 `prefers-color-scheme` 跟随系统明暗设置；侧栏只调整配色，保留原菜单结构。

DataTable 参考官方 DataTable 11：48px 表头、54px 基准行高、上下 14px 留白、14px 正文，只保留细横线。
仓库查询、列表和分页放在一张 12px 圆角卡片中，空列表也撑满可用区域。分页保留总条数，页码居中、当前页描边，每页条数位于右侧。
状态复用无边框彩色胶囊，取消列表旧的渐变与隔行填色。
数字列右对齐并使用等宽数字；主字段按钮用 `wm-table-primary`，行操作用
`wm-table-action`，次要数值用 `wm-table-muted`，保持列表和明细表一致。

弹窗使用整体弹簧入场和独立遮罩渐显，关闭后释放内容，连续打开也能完整播放。
按钮通过 `loading` 切换为等宽进度状态，保留按钮名称并阻止重复提交；关闭动画和
按钮反馈均遵循系统“减少动态效果”。动画不增加接口等待时间。

## 工作台统一接入

`TeamWorkspaceShell` 按工作台提供外观：正式库房默认 `watermelon`，其他班组默认 `glass`，也可以显式传入 `appearance`。`useWorkspaceAppearance` 将外观提供给所有子组件，包含 Teleport 弹窗。后续推广到其他班组时，从这一入口启用，不复制每个页面的样式。

- `WorkspaceDataPanel`、`WorkspaceDataToolbar`、`WorkspaceTable`、`WorkspacePagination` 统一转接 Watermelon 数据卡片、工具栏、表格和分页。原来的字段、固定列、查询、翻页和统计插槽继续由业务页面提供。
- 库房页头只保留返回与当前位置；多视图模块在同一张数据卡片顶部复用 `WatermelonSegmented` 的 Fluid Tabs 动画、键盘切换和待办数量，单视图模块隐藏页签。`MaterialReceiptScanner` 沿用原接收人和扫码签收逻辑，统一使用主题颜色、40px 控件及 `WatermelonButton`。
- `TeamWorkspaceActions` 和 `FilterDialog` 复用 WatermelonButton；AppDialog 保留 Element Plus 的焦点、嵌套弹窗和事件机制，统一外壳、控件、入场/退出动画与明暗主题。
- `DocumentCard` 通过背景变量适配附件区；原件预览保留文档本身的纸张颜色。
- `watermelon.css` 管理颜色变量，`workspace.css` 管理共享工作台布局与旧控件的主题适配。主题关闭后恢复原玻璃外观；不改变页面数据和权限。

当前覆盖库房的库存、材质/类型汇总、收发记录、转投、丢失、流水号历史、交期、质量、仓库管理和班组设置。查询、列表与分页置于一张卡片，空结果也占满可用高度；窄屏在表内横向滚动，分页留在可见区域。

## 表单与工具栏

- 库房工具栏不提供全屏或“更多”。导出、显示列、筛选及业务动作使用同一按钮组件和 40px 高度；显示列直接打开原来的列设置。
- `PublishedProcessRoutePicker` 复用数据表、搜索、按钮和分页，随库房切换明暗主题。查询和选择仍使用已发布工艺接口。
- `WatermelonDateInput` 参考 Schedule Date，提供带选中反馈的日期小窗；值仍为 `YYYY-MM-DD`，保留清除、键盘和日期范围限制。
- `AppNumberInput` 统一数字控件与加减按钮，透传原有最小值、最大值、精度和禁用属性。`WeightInput` 的 kg/g 换算保持原逻辑。
- `WatermelonNotice` 提供内联提示动画；入库必填错误在对应字段下持续展示，提交时定位到首个错误。顶部消息继续通过 `showToast` 调用，保留分组和关闭行为。
- `forms.css` 统一文本、下拉、数字、日期、多行输入的边框、40px 控件高度、焦点、禁用及错误状态。参考 Form 10 与 Select 21 的源码和实际预览；Teleport 下拉菜单同样适配，选中项使用轻底色和勾选标记。页面只使用现有表单组件，不逐页复制皮肤。

这些适配只在 Watermelon 外观下启用；表单校验、业务权限和保存接口由原业务组件负责。
