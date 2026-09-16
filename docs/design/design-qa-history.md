# Design QA — 历史记录

- Visual target: `design/reference-option-1.png`
- Implemented direction: light industrial enterprise UI, deep navy navigation, orange action accents, dense work-order table, expandable horizontal operation progress.
- Code-level checks: responsive rules, shared color tokens, table overflow handling, print-only layout, scanner focus behavior, icon-library usage, TypeScript check, unit tests, and production build.
- Browser evidence: not captured. The user explicitly requested that Codex not use its built-in browser, and no permission was given for an alternative browser or Playwright screenshot pass.
- Reference/prototype screenshot comparison: not performed for the same reason.

final result: blocked

The build is complete, but visual QA is intentionally not marked as passed without rendered browser evidence.

## 2026-09-04 导航与总表改版（当前验收）

### 比较目标与证据

- 源视觉：`output/playwright/ui-audit-20260904/01-flow-sidebar.png`。以现有深蓝、橙色工业后台为基础，按用户确认的分区导航、默认收起、合并产品规格及固定操作列方案改版，不要求复刻旧版拥挤布局。
- 实现：独立 Chrome 的 `http://127.0.0.1:4175/flows`；未使用 Codex 内置浏览器。
- 最终桌面截图：`output/playwright/ui-refresh-20260904/desktop-final.png`。
- 概览展开：`output/playwright/ui-refresh-20260904/desktop-expanded.png`。
- 窄桌面：`output/playwright/ui-refresh-20260904/desktop-1280.png`。
- 最终移动截图：`output/playwright/ui-refresh-20260904/mobile-corrected.png`；菜单证据 `mobile-sidebar.png`（账号图标修复前，菜单布局未变化）。
- 源和桌面实现均为 1440 × 1000 像素/CSS viewport，截图 scale=css，1:1，无浏览器边框、裁切或密度缩放。窄桌面为 1280 × 900，移动为 390 × 844。
- 相同管理员、同一日期范围、13 张本地演示工单。源图首条展开而最终默认收起属于获批变化；另捕获相同 DEMO-BATCH-001 展开状态检查明细入口。新旧截图已同时放入同一图像输入比较，不能把不同展开状态当作布局误差。
- 全图中的导航、行文字、图标和按钮在 1:1 下清晰可读，无需额外裁切区域。移动修复前后也在同一输入逐项比较。

### 发现与修复历史

1. 初次比较 `desktop-initial.png`：[P2] 12px 辅助文字过浅。已将规格、日期、步骤状态及移动元信息统一加深为 #607086，损耗强调为 #9a623e，原 11px 业务文字提高至 12px。最终桌面与展开截图复核通过。
2. [P2] 白字主按钮原 #f56b00 对比约 3.01:1。增加独立操作橙 #c75200（4.53:1），保留图标和品牌强调橙；最终桌面/移动截图复核通过。
3. 移动比较 `mobile-final.png`：[P2] 旧全局 `.topbar__user span` 同时隐藏了图标。改为仅隐藏非图标标签，并提供 40px 账号按钮；`mobile-corrected.png` 已显示图标，导航焦点轮廓也清晰。
4. 菜单实测消除“转废 转废”重复类型标记；/orders 新建承载页与工单流转保持唯一选中。导航测试通过。

### 必查表面

- 字体：沿用 Microsoft YaHei/PingFang SC 等现有中文字体栈；页面标题 24px，正文 14px、辅助 12px，数量等宽数字。长规格单行省略并提供 title，手机完整换行。
- 间距：24px 桌面留白、轻边框、8px 圆角；首屏可直接扫描多条工单，不再被首张展开内容占满。1280px 文档宽度仍为 1280，表格局部滚动 1136/1008px，操作列右边界 1255px；无全页横向溢出。
- 色彩：保留深蓝导航和橙色动作层级，正文/状态/辅助文字已加深。按钮、焦点和选中状态可辨识，颜色不是唯一状态提示。
- 图像与图标：沿用 Ant Design 图标组件；没有替换为自绘图片或模拟条形码。列表条码列按批准移除，真实 Code 128 仍在详情及打印页中。
- 文案：生产作业、班组产量、基础设置分组；“所在工序”允许多个工序并行，计划/在制/完成来自服务端整单数量台账，不能叠加各工序产量。扫码定位明确直接打开工单详情。

### 交互验证

- 默认班组分组和每行概览收起；工厂班组可展开并进入扎板产量，演示分组独立。
- 新建入口打开现有表单并消费 create query；没有提交新工单。
- 概览展开显示 8 道可点击工序及数量摘要；扫码输入 DEMO-BATCH-001 回车进入 /flows/13，条形码/打印/全批次数据仍存在。
- 移动导航可打开、Escape 可关闭并将焦点还给“打开导航”；关闭时 inert=true。移动文档宽度与 viewport 同为 390px。
- 106 项前端测试通过，覆盖管理员/班组、我的班组、动态目录、路由高亮、紧凑/移动切换、焦点循环、加载/失败/空状态、筛选分页、扫码、慢响应和详情加载竞态。TypeScript 与生产构建通过。
- 最后独立 Chrome 页面控制台：0 error / 0 warning。UI 检查未修改业务记录。
- 线上复核：`http://122.200.93.68:8082` 的纯锁、解锁、班组登录、13 张总表、“我的班组”、管理菜单隐藏、扫码页签切换均正常；证据 `output/playwright/ui-refresh-20260904/public-team.png`。公网控制台仅既有 favicon.ico 404，无应用脚本错误。此视图为班组角色，与管理员视觉目标的菜单差异是权限规则。

### 实施清单与范围

- 已完成分组导航、总表轻量化、移动卡片、无障碍焦点及视觉修复。
- 不涉及后端、数据库迁移或全站所有历史页面重做；已有流程详情与班组产量保持原业务功能。
- 未做真实蓝牙硬件扫码枪及所有实体车间终端型号测试；本次验证的是相同的键盘输入加回车路径。
- 无遗留可执行 P0/P1/P2 发现。

final result: passed
