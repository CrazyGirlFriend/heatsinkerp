# 仓库管理组件验收

## 2026-11-03 — 勾选列、分页与班组设置入口

- 无可选择的未分配物料时隐藏勾选列；有物料时保留批量出库，统一收窄复选框单元格内边距，去掉表头省略号。
- 共用分页组件增加总页数和 10/20/50/100 条选择；仓库默认 20 条，改变每页条数回到第一页，继续使用分页接口。
- 班组设置移入各班组的三级菜单，复用原设置表单作为独立页面，移除班组页面工具栏里的设置入口。班组长仅可设置本班组，管理员可设置所有班组；权限异常时不展示设置。
- Chrome 单会话只读检查：真实空仓位 1111 无勾选列/更多入口；临时 GET 夹具 42 条分 3 页，没有重复或遗漏；切换 10 条后返回第一页，1024×800 无页面横向溢出；设置页菜单高亮和员工页签正常。无 pageerror，夹具均已清理，未保存业务数据。
- 相关单元测试、类型检查、ESLint、生产构建通过；构建仅有既有大 chunk 提醒。证据位于 `output/playwright/warehouse-watermelon/navigation-{real,paged,narrow}.png` 和 `settings-page.png`；paged/narrow 使用临时示例数据。

## 2026-11-03 — 合并仓位与未分配列表

- 去掉仓位总览/未分配页签；同表展示未分配物料、已分配仓位与空仓。新增独立流水号和分配状态列，未分配行提供安排仓位。仓库管理移除全屏入口，从其他页全屏切入时自动退出。
- 未分配记录优先，复用原两个分页接口，按同一个窗口取数；覆盖 0、1、49、50、51、125 条未分配物料跨页与 101 个仓位组合，不重复或遗漏。导出沿用相同列表来源。
- 部分分配只显示各自实际数量，例：仓位 70 件、未分配 30 件；待签收不计入库存；同批跨位置勾选只保留一次，废料转出仍使用废料可用量。
- 提取 WarehousePlacementDialog，保留异步读取、未完成读取禁止提交、版本冲突保留表单、权限与批量出库。移除原单独未分配列表。
- Chrome 单会话验证 1440×1000、1024×800：17 行示例、未分配筛选、按流水号查找两种记录、分配弹窗默认 30 件、Escape 焦点恢复、表内横滚均正常，无 pageerror。GET 夹具结束后清理，未保存库存或仓位变更，浏览器会话已关闭并核对退出。
- 验证：5 个相关测试文件合计 45 项通过，类型检查、ESLint、Prettier 和生产构建通过；构建保留既有大 chunk 提醒。
- 截图：`output/playwright/warehouse-watermelon/unified-list.png`、`unified-placement.png`、`unified-narrow.png`。截图使用临时示例数据；本地实际只有空仓位 1111。

## 2026-11-03 — 表格层次与密度

1. 仓位列表：原截图表头只有 12px、仓位与普通数据同重，纵横线接近同强度；实测表头底线仍继承旧主题的 `#a3ada6`。调整后使用 13px 半粗表头、主字段 14px 半粗、次要零值减淡、纵线弱于横线；每行由 44px 收到 40px，外框保持完整。
2. 仓位明细与未分配物料：沿用同一 DataTable 和主字段/操作样式，数量独立列且右对齐。明细两条在库记录、待签收一条及切换均正常，待签收没有转出入口。
3. 窄屏与空结果：1024px 无页面横向溢出，表内横滚时仓位与操作列固定；键盘焦点使用内描边，避免被单元格裁断。1440px 下满表与空表高度均为 698px。

- 证据：本轮重新捕获 `output/playwright/warehouse-watermelon/table-before.png`、`table-after.png`、`detail-fixture.png`、`table-narrow-focus.png`、`table-empty.png`。多行记录是临时浏览器 GET 夹具，检查后已清除；真实仓位数据未改动。
- 验证：15 项业务组件测试、类型检查、ESLint、Prettier 通过；Chrome 的筛选、明细、Escape 焦点恢复和减少动画检查正常，pageerror 为空。未进行完整读屏或 WCAG 合规审计。

## 2026-11-03 — 表单动画补齐

- 阅读官方 Edit Profile registry 源码并在 Chrome 采样动画：遮罩独立渐显，整体表单使用 300/20/0.8 弹簧缩放与位移，没有逐字段入场。
- 共用 Dialog 补齐遮罩渐显/渐隐；关闭结束释放内容，重复打开重新入场，短时间重新打开仍保留原焦点目标。
- 共用 Button 在真实 `loading` 状态下以进度图标替换文字，保留可访问名称与原宽度。Chrome 实测保存前后均为 58px，失败后恢复按钮。
- 仓位选择显示接口读取状态，读取完成前禁止确认；Chrome 使用延迟 GET 夹具验证恢复，未保存分配。
- 连续打开两次、Escape 焦点恢复、减少动画模式、模拟保存失败后的恢复均通过，pageerror 为空。模拟保存 POST 在浏览器内拦截返回 409，没有送到后端。
- 本轮 3 个受影响测试文件共 23 项通过；ESLint、类型检查、生产构建通过，构建保留既有大 chunk 提醒。
- 证据：`output/playwright/warehouse-watermelon/` 的 `reference-form.png`、`form-saving.png`、`form-motion-final.png`、`form-loading-slots.png`，及 `check-motion.cjs`、`check-slot-loading.cjs`。

## 2026-11-03 — 正式 Vue 仓库页

- 入口：`/team-workspaces/1?tab=warehouse`，不需要试用查询参数。
- 参考 Watermelon DataTable 7、Filter Disclosure、Fluid Tabs、Edit Profile 和 Continuous Pagination。
- 新增通用 DataTable、DataToolbar、Badge；复用已有 Button、Dialog、Filter、Search、Switch、Segmented 和 Pagination。
- 正式仓位列表、批次明细、未分配物料复用 DataTable；原试用页面的整份业务副本与专用样式已移除。
- 仓位表每行 44px，字段分列；明细中的流水号、材质、类型独立列，不再拼接成一段摘要。空数据也撑满可用区域。
- 保留权限、期望版本、后台刷新、跨页勾选、批量出库、导出、共投流水号与待签收处理。
- 前端类型检查和生产构建通过；受影响代码 ESLint、Prettier 通过。构建仍有既有大 chunk 提醒。
- 7 个相关测试文件共 36 项通过，包含库存与待签收隔离、批量出库、权限撤销、锁定仓位、版本冲突、筛选、焦点和键盘操作。
- Chrome：1440×1000 与 1024×800，页面无水平溢出；内部表格横向滚动，操作列固定。筛选、重置、弹窗 Escape、返回焦点、减少动画设置通过，运行时 pageerror 为空。
- 仓位分配弹窗的下拉选择、数量输入与取消已在 Chrome 验证，未保存。自动化始终使用同一个 Chrome 会话，结束后关闭。
- 多行截图使用临时 GET 拦截的 24 个示例仓位。脚本 finally 清理并恢复真实的 1 个仓位；未提交仓位、分配或出库变更。页面自身的通知刷新 POST 不涉及库存保存。
- 证据：`output/playwright/warehouse-watermelon/` 的 `list-fixture-1440.png`、`list-fixture-1024.png`、`detail-fixture.png`、`filter.png`、`editor-1024.png`、`real-final.png`。带 fixture 的图片为示例数据。

## 历史记录（已被上述正式入口替代）

## 2026-11-03 — Watermelon 仓库管理试用页

- 入口：`http://127.0.0.1:5179/team-workspaces/1?tab=warehouse&ui=watermelon`。右上角「返回原版」立即移除查询参数；原入口恢复 WarehouseManagement，零试用样式、motion-v 资源加载（Chrome performance 验证）。
- 所有试用组件、页面副本、样式、测试、许可和移除程序集中在 `frontend/src/components/watermelon`。生产页面只保留一处带标记的异步接入；原仓库管理组件内不再有 Watermelon 引用。保留其他任务的新表单修改，没有整文件 git 回退。
- 适配真实 Watermelon 源码：Filter Disclosure、Fluid Tabs、Edit Profile 和 Continuous Pagination。新增/编辑弹窗沿用源组件的浅灰外壳、白色嵌入内容、左右编辑/预览、黑色圆角操作和 300/20/0.8 弹簧参数。仓位卡片为本业务设计，未宣称官方仓库组件。完整 MIT 许可见 NOTICE。
- 组件化：Button、Filter、Segmented、Search、Switch、Dialog、Pagination 共 7 个通用组件，不依赖仓库 API/类型；页头切换和详情批次切换复用同一 Segmented。各组件自带样式，按钮加载样式不再依赖工具栏，仓库弹窗专属样式限定 wm-warehouse-dialog。README 提供 API 与跨业务接入示例。
- 紧凑布局：仓位格由 92px 降至 70px，去掉重复箱子图标。Chrome 在 1440px 下验证每排 10 格，在 1024px 下无横向溢出。
- 信息约束：仓位格只呈现名称、状态；流水号、数量和批次留在详情。页面压缩重复标题，没有添加解释段落。
- 可逆验证：4 项移除测试通过，包含预演不修改、移除保留周边变更、npm 失败保留入口、入口被改动时停止。依赖卸载还在临时 package/lock 副本中执行过，motion-v/framer-motion/motion-dom/motion-utils/hey-listen 全部消失。
- UI 验证：33 项测试通过（原仓库 11 + 试用工具栏 4 + 通用组件 18）；类型检查、生产构建通过；新文件 ESLint 通过。构建有已有大 chunk 提醒。
- Chrome 只读验收：返回原版、新增弹窗及取消、开关、筛选/重置、未分配/仓位切换、Escape、减少动画、仓位与详情、1024px 视口无横向溢出。最终重新加载后 pageerror=[]、console warnings=[]；筛选再次点击可关闭；原生弹窗中的分段选择和方向键切换通过。没有保存业务数据。自动化只使用一个 Chrome 会话，验收后关闭并确认进程退出。
- 本轮真实本地仓位为 1，未改动该记录；有数据截图仅浏览器 GET 拦截使用 48 个示例并注明，finally 清理拦截、恢复真实数据。截图与官方组件在同次图像输入对比，编辑弹窗使用相同 1200×682 视口。源组件 6 字段适配为仓位 2 字段，因此主动缩短宽高；无未处理的 P0/P1/P2。
- 证据：output/playwright/watermelon-preview/{reference-edit,isolated-editor,warehouse-fixture,warehouse-detail,warehouse-narrow,original-restored,warehouse-live-final}.png。脚本 check-warehouse.js 和 check-isolation.js。

final result: passed

## 2026-11-03 — DataTable 11 与系统明暗主题

- 本轮以用户新指定的 DataTable 11 取代之前的紧凑 DataTable 7 方向。读取官方 registry 源码，并在同一 Chrome 会话查看其浅色和深色页面。源码证据：`output/reference/watermelon-vue/data-table-11.json`；参考截图：`output/playwright/warehouse-refinement/reference-11-{light,dark}.png`。
- 表格采用 48px 表头、54px 基准正文行、14px 上下内边距、14px 正文、细横线与无边框彩色状态胶囊。取消纵向格线、隔行色块和列设置菜单。业务字段仍各自成列，数量右对齐；常用 1440px 视口完整显示表头，1024px 使用表内横滚与固定仓位/操作列。
- 查询、列表、分页共用一张 12px 圆角数据卡片，主内容外壳不再重复套框；白色/黑色卡片与页面底色轻微区分。空表或只有一行仍占满可用高度。官方演示的表格/分页两个独立卡片在本业务中合为一张，保留当前页描边、居中页码、右侧每页条数选择。
- 通过 CSS prefers-color-scheme 跟随系统主题；取消表体背景过渡，避免主题切换短暂出现整片中灰。侧栏只适配颜色和背景，菜单结构与尺寸保持原样；品牌图片深色时保留小面积白底以确保可读。作用域仅仓库管理试点及它的共用弹窗，不改变其他业务页主题。
- 共用 Filter、Dialog、Button、Switch、Segmented 使用同一主题变量；弹窗两种主题保持相同几何尺寸、Escape 与焦点恢复。
- 视觉复查：浅色/深色列表与参考分别核对卡片、表头、行距、状态和分页；检查真实一条数据、42 条只读浏览器夹具、筛选面板、安排仓位弹窗及 1024px 窄屏。没有页面横向溢出，分页可见；截图 `list-*`、`filter-*`、`placement-*`、`narrow-dark.png` 使用临时示例数据，`real-*` 是本地真实数据。所有 GET 拦截在 finally 中清理，未写入业务记录。Chrome pageerror=[]。
- 验证：40 项相关单元测试通过（分页文案断言同步新版后重跑仓库 13 项通过）；vue-tsc、ESLint、Prettier、生产构建及 git diff --check 通过。构建仍有既有大 chunk 提醒。未进行完整读屏/WCAG 审计。
- 自动化复用唯一 Chrome 会话 warehouse-watermelon，结束时关闭并确认进程 50281/50282 及临时 profile 的子进程退出。

本轮结果：通过。

## 2026-11-04 — 库房工具栏、表单和弹出层统一

- 库房移除全屏与“更多”，显示列直接展示；筛选、导出和新建动作统一使用 40px WatermelonButton。旧玻璃班组保留原入口。
- 工艺选择复用 WatermelonDataTable/Search/Pagination，深色表头实测为 rgb(22,22,22)，背景图为 none；真实本地工艺记录可正常加载。
- 读取 Schedule Date、Floating Input、Inline Toast、Form 10、Select 21 的官方源码，并在同一 Chrome 查看表单、下拉和必填错误示例。`forms.css` 统一库房文本、数字、下拉、多行输入的尺寸、焦点、禁用和报错状态；保留现有 Vue 表单引擎。不是官方 Vue 包。
- 修复 Teleport 下拉选项的玻璃渐变、错误输入框的白底、主按钮悬停的绿色渐变，以及旧 max-width 导致重量小数被截断。数字加减按钮只在悬停时填色。
- Chrome 验证：1440×1000 和 1024×800，全部主要工具按钮高 40px，窄屏最右按钮为 975px，页面无横向溢出；日期选择与 Escape、减少动画设置、重量 0.000123 kg → 0.123 g、数量加一、字段报错定位、通知提示通过。空表单提交未发送业务写请求。
- 83 项已有相关测试通过；工作台 125 项中受全屏移除影响的一项断言更新后单独重跑通过，其余 124 项通过；新增 2 项控件测试通过。类型检查、ESLint 和生产构建通过，保留既有大 chunk 提醒。
- 临时 /auth/me GET 仅用于浏览器展示库房账号，未更改服务器权限或保存业务记录；在 finally 中移除并返回真实管理员页面。最后本地 Chrome pageerror=[]。
- 参考源码：`output/reference/watermelon-vue/`。预览与验收截图：`output/playwright/warehouse-polish/`，其中 `reference-*` 为官网，`receipt-*` 为未保存的本地入库表单。
- 自动化只使用 warehouse-polish 一个 Chrome 会话；验收后关闭，已确认根进程 62788、浏览器 62789 及其临时 profile 子进程全部退出。

## 2026-11-04 — 库房页签与扫码区

- 复用现有 Fluid Tabs 的 Vue 适配组件，将库房视图页签移入数据卡片顶部；页头保留返回、班组和模块。保留滑动指示器、键盘切换与待签收数量，单视图不显示页签。
- 扫码区继承 Watermelon 黑白主题，接收人、条码输入和按钮统一为 40px；保留必须选择接收人、扫码确认及版本校验。
- Chrome 验证页签点击、键盘 Home、接收人选择、条码输入启用、深浅色和 1440/1024/768px 布局。页面无水平溢出，窄屏分页可见；未提交扫码或其他业务保存。
- 使用浏览器内临时班组身份展示扫码区，结束时恢复原管理员会话并移除 GET 拦截。验收截图在 `output/playwright/warehouse-tabs/`；列表使用真实空数据。
- 48 项组件测试通过。工作台 125 项测试中 115 项通过，10 项旧导航选择器更新后连同切换测试重跑 11 项通过；类型检查、ESLint、Prettier 和生产构建通过。
- Chrome 无运行时错误；身份夹具切换时出现既有重复 key 警告，未在本轮样式改动中扩大处理范围。唯一自动化会话 warehouse-tabs 已关闭，确认根进程 71597、浏览器 71601 及其临时 profile 子进程退出。

## 2026-11-03 — 库房工作台统一组件试点

- 在 TeamWorkspaceShell 提供外观上下文；库房默认启用，其他班组仍走原样式。共享的数据卡片、工具栏、表格、分页、筛选按钮、班组操作与 AppDialog 自动继承，Teleport 弹窗不会丢失主题。
- 复用 Watermelon 组件和颜色变量，没有新增业务接口或复制库存逻辑。保留列表固定列、搜索、分页、权限、出入库和共投/转投事件；DocumentCard 改用可覆写背景变量。
- Chrome 顺序查看库存、材质库存、类型库存、待签收、入库、出库、转投、丢失、收发历史、交期、质量、仓库管理、设置。空列表撑满；材质汇总分页底部为 951px（1000px 视口），修复原来被空表挤出的问题。
- 只在浏览器 GET 响应中临时放入 23 条库存示例，验证第 2 页、20 条/页、搜索只剩 1 条；1024×768 时表内可横滚，页面没有水平溢出，分页底部为 719px。相关 fixture 截图不是业务真实库存。
- 使用临时 /auth/me GET 响应展示库房账号的入库表单，不保存表单；检查明暗主题、附件卡片、Escape 关闭。窄屏操作区自动换行，入库/出库/扫码全部可见（最右 975px，小于 1024px 视口）。所有拦截在 finally 中移除，并恢复真实管理员页面。
- 最后复查 Chrome pageerror=[]。没有修改任何库存、工艺、排期或用户权限数据。
- 验证：37 项共享组件测试通过；312 项关联业务测试在修复断言后分组重跑通过，其中一个在并行执行时超时的库存时钟测试以单工作进程单独通过。类型检查、ESLint、Prettier、生产构建和 git diff --check 通过；构建仍有原有的大 chunk 提醒。
- 证据目录：`output/playwright/warehouse-global/`。`inventory-real-final.png`、`warehouse-real-final.png` 为真实空库存/仓位；`fixture-inventory-*.png` 为临时库存示例；`receipt-form-*.png` 为临时班组身份的未保存表单；`receipts-team-narrow-final.png` 为窄屏操作区。
