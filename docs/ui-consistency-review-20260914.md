# 全项目界面一致性审查

日期：2026-09-14。审查先在本地完成；用户随后授权，前端已发布为 `20260914T123620Z`。发布验证见 `server-deployment.md`，以下截图仍为本地审查证据。

## 结论

普通业务页面已统一为确认过的浅白紫视觉体系。主要问题是首页独有的导航/字体规则、业务表头蓝灰配色、深蓝登录页以及流水号详情的小字号；本轮已修正。保留首页玻璃卡片、业务实底表格和独立大屏三种用途的区别，而不是把所有页面做成同一种卡片。

范围为前端视觉与阅读体验审查，不是后端安全审计或所有业务操作的完整验收。当前数据来自本地演示库；没有提交入库、出库、确认、丢失、加急或删除操作。

## 1. 登录与首页 — 已统一，首页构图保留

优点：登录表单简单、首页八班组和库存/在途层级清楚。
原问题 P2：登录品牌区是深蓝色，和已确定的白紫首页脱节。已复用白紫素材、加深正文、提高输入字号；首页原背景透明度、设备素材、卡片布局和实时同步没有修改。

![35-after-login](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/35-after-login.png)

![32-after-home](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/32-after-home.png)

## 2. 全局导航与班组工作台 — 已统一

原问题 P2：首页与班组页切换时侧栏宽度、子项图标、字号不同。已改为共用外壳、200px/64px 侧栏及统一的二级图标位置。
原问题 P2：表头仍是蓝灰色，文字/页签各用一套颜色。现在引用共用颜色变量，正文保留 16px，表头与选中态有明确对比。

同一视口、同一管理员、相同演示数据的前后比较（1437×1095，DPR 1）；下面是同一输入中的局部，并非新生成效果图：

![focus](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/focus.png)

已分别打开库房、轧制、退火、研磨、线切割、雕刻、电镀、检验台账；库房的待接收、库存、出库、入库、丢失、材质归类、分析页签均检查。其余七班组使用同一套页签组件，未逐一穷举每个班组与每个页签的组合。

![teams](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/teams.png)

![tabs](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/tabs.png)

## 3. 转料、扫码、追踪 — 已统一

优点：转料保留来源/去向分列、内容居中；扫码沿用 CK 整批和历史 TL 详情；追踪保留流水号时间线，没有新增装饰卡片。
已统一表头、字色、日期控件和导航。桌面筛选区实际边界在视口内；手机自动换行。日期弹层已实际打开检查；本轮没有提交日期查询来验证后端筛选正确性，相关功能由已有单测覆盖。

![23-after-transfers](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/23-after-transfers.png)

![27-after-scan](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/27-after-scan.png)

![28-after-trace](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/28-after-trace.png)

## 4. 班组与账号设置 — 已统一

优点：已有标准 Element Plus 表单和清晰的编辑/停用操作。本轮共用字体、表头和操作颜色；新增账号弹窗已打开检查后关闭，没有创建账号。

![25-after-accounts](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/25-after-accounts.png)

![26-after-account-dialog](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/26-after-account-dialog.png)

## 5. 单据、流水号详情与打印 — 已修正

优点：单据本身已是表格，不需要重排为卡片。屏幕表格头统一浅紫，纸张仍黑白。
补充问题 P2：流水号详情的主要字段沿用 small 尺寸，部分文字只有 11–12px，且默认 20 条。已改为元数据 14px、明细 15px、辅助 14px，默认 10 条；手机保留可横向查看的完整表格。

![34-after-dispatch](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/34-after-dispatch.png)

![40-serial-detail-final](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/40-serial-detail-final.png)

打印检查：点击真实“打印整批单”，截取当次生成的单据 DOM，在 Chrome 的 print 媒体下检查；不是实际打印机测试，也不代表超多明细的跨页分页测试。三条明细、一个条码、合计和签字位清楚，未带业务页面背景。

![36-print-style](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/36-print-style.png)

## 6. 分析与独立大屏 — 正常，保留专用展示风格

普通分析页统一浅白紫、图表中文字体和 14px 图例/坐标文字。不同数据系列仍用不同颜色。P3：长流水号的图表轴标签仍截短，完整信息需悬浮或进入台账；本轮不扩大图表占地。
机器人大屏在 2560×1440 检查，模型、背景、八班组和动态记录均显示，页面无业务侧栏；保持一个 canvas。分析的大屏模式也单独检查，不改成白色列表。

![29-after-analysis](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/29-after-analysis.png)

![38-robot-2k](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/38-robot-2k.png)

## 7. 响应式与验证边界 — 已检查，有明确范围

首页、转料、台账、账号页在 390×844 和 2560×1440 检查，文档宽度等于视口。手机表格可内部横向滚动；图中未显示的列并非被删除。流水号详情也检查手机布局。桌面收起导航宽度实测 64px，图标居中。

![mobile](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/mobile.png)

![2k](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/output/playwright/project-consistency-20260914/2k.png)

基于共用纯色值计算：正文/页面底 16.19:1、辅助文字/页面底 5.33:1、主色/白色 7.23:1、表头文字/表头底 13.98:1。仅覆盖这些纯色组合，不代表玻璃合成背景、所有状态、屏幕阅读器或 WCAG 全面认证。登录焦点、日期语义和减少动画机制保留。

前端全量 52 个文件、382 项测试通过；补充流水号详情分页断言单测通过；TypeScript 和最终生产构建通过。仍有既有 Vue 测试环境警告及 ECharts/Three 大分包提示，不属于本轮新增缺陷。

未检查：线上发布、后端全量回归、真实打印机、4K、屏幕阅读器、多权限写入全流程。访问锁在本地配置下未启用，未宣称实际访问锁页面验收通过。

在上述已检查范围内没有遗留 P0/P1/P2 视觉问题；小弹层的辅助提示和图表长标签仍可做 P3 微调。后续按 [界面一致性约定](/Users/zhangsen/Documents/code/python_code/HeatSinkREP/docs/ui-style-guide.md) 使用共用规则，避免重新分成多套样式。
