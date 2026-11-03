## 历史验收记录

当前状态：Vue 试用入口已停用，正式页面保留原玻璃样式。以下记录对应此前试用版本，其中的查询参数入口及移除脚本已不适用于当前代码。后续独立 React 版本待组件选型确认后实施。

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
