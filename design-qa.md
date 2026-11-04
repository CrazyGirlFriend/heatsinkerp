# 生产排期看板视觉检查

Date: 2026-11-04

final result: passed

## 对照目标与证据

- 参考页面：https://bryntum.com/products/scheduler/examples/tasks/
- source visual truth: `output/playwright/reference-bryntum-tasks.png`
- implementation: http://127.0.0.1:5179/production-schedules
- implementation screenshot: `output/playwright/schedule-bryntum-final.png`
- 两张完整截图均为 1440 × 900 像素，CSS viewport 1440 × 900、deviceScaleFactor 1；没有密度缩放。
- 状态：浅色、展开父分组、未悬浮。参考内容是员工任务，项目内容是实际流水号和班组批次；对齐分组、栅格、色块与层级，不复制员工示例数据。
- 完整截图在同一个图像工具结果中同时打开并比较。
- 局部证据：`schedule-reference-focus.png` 与 `schedule-implementation-focus.png`（均位于 `output/playwright/`），按原始像素裁取 1000 × 300，并在同一次图像结果中比较表头、行距、文字及时间块。
- 交互证据：`schedule-bryntum-hover2.png`、`schedule-bryntum-dark-hover-final.png`、`schedule-bryntum-collapsed.png`、`schedule-bryntum-1024.png`，均位于 `output/playwright/`。

## 比较与修复记录

1. 初版 `schedule-bryntum-pass1.png`：旧主题覆盖使色块文字变暗，属于 P1 可读性问题。删除该覆盖，改用白字；`schedule-bryntum-pass2.png` 与最终截图确认恢复。
2. 时间尺度：原来把多天压入一屏，短批次难以辨认。调整为默认周视图、每日至少 192px，8 小时计划呈现 64px 宽，时间位置仍按保存的数据计算。超出窗口可横向滚动。
3. 深色悬浮标题对比偏弱（P2）：标题颜色混入主题前景色。`schedule-bryntum-dark-hover-final.png` 确认标题和日期、数量均可辨认。
4. 键盘验证发现 Popover 默认拦截回车（P1）。关闭其触发快捷键，让原生按钮处理 Enter；复测确认焦点显示悬浮框、Enter 打开对应流水号和班组详情。
5. 最终完整和局部对照：没有发现仍需修复的 P0/P1/P2 问题。

## 五项视觉检查

- **字体**：沿用项目中文字体和系统回退；流水号加粗，辅助信息降级，时间块单行白字。参考图英文任务有两行内容，本项目按用户要求只显示批次或班组，详细信息放悬浮框。
- **布局**：固定流水号/班组列与计划数列；班组行 60px，交叠批次增加独立轨道；参考图行高同为约 60px。批次块采用 34px 高而非参考的双行 44px，保留足够留白。应用侧栏和分页继续保留。
- **颜色**：班组使用稳定颜色；细分隔线、浅色周末底纹、今日竖线。交期状态用独立图标区分待完成、按时完成、逾期未交齐、逾期完成；未以签收数代替转出完成状态。
- **资产**：保留本项目已有品牌图标，操作与状态使用现有 Tabler 图标。参考示例员工照片不映射为虚构班组人员；没有新增装饰图片。
- **文案**：主图保留流水号、计划数、班组、批次及在库数。约定交期、实际交齐、应交、已转出、下序已签收分别显示在悬浮框中。去掉主图点击后出现的说明页脚及依赖连线。

## 验证

- 24 项相关单元/组件测试通过：排期布局与状态、悬浮数量、主图交互、分页和筛选。
- Vue TypeScript 检查通过；修改的 Vue/TS 文件 ESLint 通过；`git diff --check` 通过。
- Chrome：展开/收起、鼠标悬浮、点击查看明细、键盘焦点与回车、浅色/深色主题验证通过。
- 1440px 与 1024px 窗口无页面横向溢出；图内横向滚动 300px 后，固定表头和流水号列 x 坐标均为 249px。
- 浏览器控制台：0 个错误。没有创建、修改或保存业务数据。
- 已关闭本任务的 `schedule-style` 自动化浏览器，并确认所记录 PID 28836 已退出；本地前后端服务保留运行。

## 范围与限制

本次实现为现有 Vue 组件的样式和交互调整，新增时间块、交期标记两个可复用组件。未更改后端排期或交接规则。浏览器检查使用本地已有测试数据；未检查线上部署，也未执行提交或推送。

---

# VTable 甘特图单流水号试用

Date: 2026-11-04

final result: passed

## 范围和参考

- 本节对应本轮新增的 VTable 试用入口；上文保留此前 Bryntum 样式检查记录。
- 用户参考：https://github.com/VisActor/VTable/blob/develop/README.zh-CN.md
- 实际查看的官方示例：https://visactor.io/vtable/demo/gantt/gantt-project-taskShowMode
- 安装并使用 `@visactor/vtable-gantt@1.26.8`，通过 Vue 组件封装；不是静态截图或仅模仿样式。
- 试用入口：http://127.0.0.1:5179/production-schedules?timeline=vtable&serial_no=691236-51
- 使用本地真实流水号 691236-51、8 个班组工序及已保存的批次。未修改业务数据，未改纵览页面，未提交或推送。

## 视觉证据

- source visual truth：`output/playwright/vtable-project-tasks-reference.png`。
- implementation：`output/playwright/vtable-pilot-light-final.png`。
- 两张完整图均为 1440 × 1000，浅色、分组显示、无悬浮；以 CSS 像素截图，不做截图缩放。两张完整图在同一工具结果中打开比较。
- 局部原始像素对照：`vtable-reference-focus.png` 与 `vtable-implementation-focus.png`，均 500 × 320，在同一图像输出中比较。
- 深色：`vtable-pilot-dark-final.png`；深色悬浮：`vtable-pilot-dark-hover-final.png`。
- 日期小窗：`vtable-pilot-date-picker.png`；横向滚动：`vtable-pilot-scroll.png`；1024 × 900 窗口：`vtable-pilot-1024.png`。
- 详情弹窗：`vtable-pilot-detail.png`；流水号收起：`vtable-pilot-collapsed-final.png`。上述图片均在 `output/playwright/`。

## 对照结论与修复

- 字体：沿用应用字体，主列 13px、日期 12px、批次短标签 11px。流水号加粗，数量独立右对齐，不把交接数量堆进单元格。
- 布局：采用官方原生树形表格和时间轴，同一班组批次可同行或展开。固定左侧 300px，常规行高 56px、时间条高 24px；与示例约 40px 的行高不同，这是为中文班组和交期状态保留点击区域的业务适配。
- 颜色：保留稳定班组色，终点图标单独表示交期状态；应用黑白主题替换示例蓝色表头。没有复制员工姓名、照片或依赖连线。
- 资产：已有品牌和 Tabler 图标；状态图标由现有图标组件输出 SVG 给 Canvas 使用。
- 文案：主图保留流水号、数量、班组和批次。计划开始、约定交期、实际交齐、应交、已转出、下序已签收移入悬浮框。最终交期为独立里程碑。
- P1 修复：未开启原生选择时，VTable 不发出时间条点击事件；启用选择并保留禁止拖动/改期，点击正确打开原有班组详情。
- P1 修复：批次使用负数合成 ID，点击时转换回真实班组排期 ID，避免打开错误记录。
- P1 修复：深色正文、树形箭头、悬浮底色显式使用主题色；原生 `updateOption` 未刷新画布容器底色，切换主题时释放并重建实例，保留滚动位置。
- P2 修复：重叠批次、终点状态及最终交期标记分行避让，保持真实起止时间不变。8 小时批次仍按 8 小时宽度展示，不扩成整天。
- P2 修复：隐藏小时刻度使原生“今天”文字被截断，改在日期表头标注“今天”，竖线仍指向当前时刻。
- P2 修复：1024px 下搜索与日期控件争抢空间，容器宽度不足时分两行，刷新按钮和完整搜索值恢复可见。
- 最终对照未发现本轮范围内未修复的 P0/P1/P2 问题。

## 验证结果及限制

- 18 项相关测试通过：任务面板 10 项、原时间条悬浮 1 项、数据适配 6 项、VTable 包装和释放 1 项。
- Vue TypeScript、修改文件 ESLint、Prettier、`git diff --check` 通过；生产构建通过。
- Chrome 验证了班组/批次展开、流水号收起、鼠标悬浮、点击班组详情、日期小窗应用、本周快捷选择、放大、恢复全部交期及深浅色切换。
- 线切割第一批悬浮显示应交 416、已转出 352、下序已签收 352，保持三种数量独立；库房计划 60 件与后序 480 件保留各工序原始数量。
- 横向滚动后左侧表格仍位于 x=249；1024px 窗口 document.scrollWidth=1024，无页面横向溢出。最后一次加载和日期/缩放操作未捕获 pageerror。
- 本任务仅使用一个 Chrome 自动化会话 `vtable-pilot`，已关闭并确认 daemon PID 43608 和 Chrome PID 43613 退出。前后端服务保留运行。
- VTable 懒加载产物约 2.4 MB（gzip 592 KB），构建有大块提示；仅试用入口按需加载。正式推广前仍需在目标设备和大批量真实记录上评估首次加载及性能。
- 当前验证范围为本地单流水号试用，未部署线上，也未声称完成所有流水号的上线验收。

---

# VTable 生产排期主入口视觉调整

Date: 2026-11-04

final result: passed（本轮前端显示和交互范围；实时通知接口故障见限制）

## 本轮范围

上一轮试用只确认了组件接入，用户明确反馈视觉仍与旧版相似。本轮直接调整 `/production-schedules` 默认入口，不再需要 `timeline=vtable` 参数。保留调度管理表、原有明细弹窗和业务接口；没有修改纵览或后端。

## 参考与实际证据

- 参考：https://visactor.io/vtable/demo/gantt/gantt-project-taskShowMode
- source visual truth：`output/playwright/vtable-style-source.png`。
- 实际入口：http://127.0.0.1:5179/production-schedules
- 最终截图：`output/playwright/vtable-redesign-final.png`。
- 完整截图均为 1440 × 1000、浅色、无悬浮，同一次图像输出中对照。参考是官方文档内嵌示例；本项目保留应用侧栏和真实业务数据，不将文档外壳当作产品布局复制。
- 原始像素局部：`vtable-redesign-source-focus.png`、`vtable-redesign-focus.png`，均为 330 × 320，同次输出比较表头、圆角条和栅格。
- 其他证据均在 `output/playwright/`：`vtable-redesign-collapsed.png`、`vtable-redesign-batches.png`、`vtable-redesign-dark-hover-final.png`、`vtable-redesign-this-week.png`、`vtable-redesign-1024.png`、`vtable-redesign-scroll.png`、`vtable-redesign-detail-loaded.png`。

## 对照调整

- 字体与文案：批次文字放进色条，短条在缩小时显示“1批”等短标签。主图不堆叠交接数量、日期和说明；应交、已转出、下序已签收保留在悬浮框中。
- 布局：固定列由 300px 改为 280px，常规行高由 56px 改为 48px；时间条 24px 高、12px 圆角。默认仅展开第一条流水号，其他流水号可收起总览；班组可继续展开为独立批次，数量在独立列展示。
- 比例：默认日期宽度由 80px 改为至少 168px，8 小时批次显示约 56px，仍使用真实小时，不把短计划扩成整天。50%–200% 缩放、日期小窗和横向滚动可调整可见范围。
- 颜色：采用参考的蓝色日期表头、白字和细网格；表头蓝色加深至 `#3474c8`，对白字对比约 4.69:1。班组沿用稳定颜色，待完成为浅底描边，逾期和完成使用小状态标记；深色表头使用 `#203e6c`。
- 资产：继续使用项目品牌和 Tabler 图标；不引入参考中的员工照片、虚构人员或依赖连线。

## 发现并修复

1. P1：只监听宽度会导致窗口高度变化后画布覆盖图例。补充高度监听和图表区域裁切；1024 × 900 与 1024 × 700 的画布底边分别为 709、509，图例顶边为 710、510，互不覆盖。
2. P1：VTable Gantt 1.26.8 的释放方法未释放 scenegraph，热更新后旧指针监听可能访问已清空的画布。封装组件显式释放 scenegraph，再释放 Gantt；新增释放和高度变化回归断言。
3. P2：数量表头被截断，改为“数量”；缩放后批次标签截断，采用短标签；大状态圆圈改为 13px 角标。
4. P2：全屏时没有透传退出操作，补充 `view-actions` 插槽；已验证进入和退出。
5. P2：流水号手动折叠后全局展开按钮状态不一致，随原生树状态事件同步。

## 验证与限制

- 19 项相关测试通过，Vue TypeScript、修改文件 ESLint、Prettier、生产构建及 `git diff --check` 通过。
- 本地共 31 条任务，当前页 10 条。全部收起时原生表格 11 行，展开流水号后 101 行；同一班组批次可独立展开，确认线切割 416、64 两批的数量分别显示。
- 悬浮确认应交 416、已转出 352、下序已签收 352；点击进入真实排期 #11，未保存业务数据。
- Chrome 验证日期选择、本周、缩放、树形展开、详情、主题切换和全屏退出；最终各轮检查未捕获 `pageerror`。
- 1024px 窗口 document.scrollWidth=1024；横向滚动后固定表格仍在 x=249，左侧宽度 280px。
- 已知限制：本地 `/api/factory-overview/changes` 实时通知接口持续返回 503，页面显示重连提示。普通排期和明细请求正常。本轮没有修改后端，也不将该接口记为通过。
- VTable 按页面懒加载，产物约 2.42MB（gzip 596KB），构建仍有大块提示；没有声称完成大数据压力测试或线上发布。
- 本任务复用一个 `vtable-design` Chrome 会话，已关闭；daemon PID 55882、Chrome PID 55898 及所记录子进程均确认退出。本地服务继续运行。未提交或推送。

---

# VTable 百分比甘特图：按官方源码调整

Date: 2026-11-04

final result: passed（本轮图表显示和交互范围；不代表用户已认可视觉结果，实时通知故障仍见下方限制）

## 源码与视觉依据

- 用户选定示例：https://visactor.io/vtable/demo/gantt/gantt-customLayout。
- 已读取完整官方源码：https://github.com/VisActor/VTable/blob/develop/docs/assets/demo/zh/gantt/gantt-customLayout.md。具体对照 `columns.customLayout`、`taskBar.customLayout`、`timelineHeader.scales[].customLayout`。
- 源码的任务条是完整的浅色—班组色—浅色三段渐变，百分比独立置于白色圆章；它没有把渐变条截成百分比填充，也没有额外的弹跳动画。
- 参考截图：`output/playwright/gantt-source-code-reference.png`，1325 × 522，浅色，官方原始业务记录，无悬浮；通过扩大浏览器视口使官方文档内嵌图表宽度与项目图表接近，未修改示例的任务数据或绘制样式。
- 本地截图：`output/playwright/gantt-source-matched-final.png`，1324 × 768，浅色，无悬浮，取自 1600 × 1000 浏览器中的实际组件。两图已在同次图像输出中比较，均为 CSS 像素密度 1；项目额外保留工具栏、流水号层级、数量列和图例，未宣称整个页面像素完全一致。

## 本轮修正

1. 最初仅增加百分比、缩小条高，并把渐变画成分段进度填充，偏离用户选定的示例；已移除该填充方式，采用源码中的完整三段渐变、60px 条高、80px 行高、30px 圆角、50px 图形区域、40px 百分比圆章及相应文字层级。
2. 左侧班组卡片显示班组和排期日期，日期表头采用日历图标、日期、星期；背景统一为示例的 `#f0f0fb`，去掉纵向网格，保留柔和横线。深色模式同步适配。
3. 官方动物头像映射为本项目已有的班组图标，复用 `FactoryNavIcon`，不捏造负责人和头像。使用真实开始/结束时间，短批次不人为拉长。
4. 班组行展示各批次最早开始至最晚交期的排期区间和班组总交接百分比；此区间可包含批次间空档，不等于累计加工时长。展开后仍可检查每批的真实起止时间。总百分比取实际转出总量与目标量，不能平均批次百分比；下序签收独立保留。
5. 自定义左侧卡片曾遮掉原生展开入口，已保留 VTable 树控制，仅替换文字。原生范围外定位箭头移到行上缘，避免挡住百分比。
6. 缩小至 50% 时短条曾出现两行省略号，已改为单行班组名称与小图标；更短的批次保留图标并通过悬浮查看详情。百分比圆章仅在宽度足够时显示，避免挤在一起。

## 验证与限制

- 25 项相关测试通过：数据适配 10、交接进度 14、组件交互与释放 1。Vue TypeScript、修改文件 ESLint、Prettier、生产构建及差异空白检查通过。
- Chrome 实测线切割班组总进度为 352/480，即 73%；第一批悬浮显示应交 416、已转出 352、下序已签收 352。点击打开对应真实排期明细，未提交业务表单。
- 验证班组/批次展开、流水号折叠、悬浮、明细、缩放及深浅色切换，未捕获本地页面 `pageerror`。1024px 窗口页面 scrollWidth 为 1024。
- 证据：`gantt-source-matched-batches.png`、`gantt-source-matched-collapsed.png`、`gantt-source-matched-dark.png`、`gantt-source-matched-narrow.png`，位于 `output/playwright/`。
- 仍有既存 `/api/factory-overview/changes` 503，页面保留实时连接重试提示；普通排期和明细 API 正常。本轮没有修改该后端问题或纵览页面。
- VTable 按需加载块约 2.43 MB（gzip 598 KB），生产构建仍提示大块；本轮没有做大数据压力测试或线上发布。
- 浏览器检查只复用 `gantt-progress` 会话，检查完成后关闭；本地前后端服务保留运行。未提交或推送。

### 实时通知 503 修复复查（2026-11-04）

- 上述 503 的原因已确认：本机 Docker 未运行，RabbitMQ 的 `127.0.0.1:5672` 连接被拒绝。恢复 Docker 后，原有 `heatsinkrep-mq-1` 容器自动启动并达到 healthy；未重建消息队列、数据库或数据卷，后端自动重连。
- 本地后端 `8019` 与前端代理 `5179` 的 `/api/factory-overview/changes` 均实测返回 200 和 `text/event-stream`，收到初始 `inventory-changed`。
- 使用独立测试登录会话并注销，验证数据库 outbox → RabbitMQ → SSE 实际收到 `auth-expired`，耗时分别为 83 ms 和 48 ms；不是仅检查端口或 HTTP 状态。
- 管理员通知状态为 `connected`，待发送消息为 0。验证会话全部注销，未修改库存、排期等业务数据。此次未启动浏览器、未验证或部署线上服务。
- 补充 `backend/README.md` 的本地 RabbitMQ 启动、配置匹配及状态检查步骤。

### 排期图比例收薄（2026-11-04）

- 按用户要求将行高 80→60、排期条及班组卡片高度 60→40、日期表头 80→64；图标 50→32、百分比圆章 40→28，文字与定位箭头同步调整。保留班组颜色及渐变，减弱两端明暗差；日期宽度、真实起止时间、数量和进度计算未变。
- Chrome 1600×1000 下，第一条流水号的 8 个班组可以完整显示。实测批次展开、短批次、50% 缩放、悬浮详情、点击打开原排期明细及深浅色切换；浏览器错误为 0。
- 11 项相关测试、Vue TypeScript、修改文件 ESLint / Prettier 和差异空白检查通过。
- 截图：`output/playwright/gantt-slim-final.png`、`gantt-slim-hover.png`、`gantt-slim-batches.png`、`gantt-slim-50.png`、`gantt-slim-dark.png`。只复用一个 `gantt-slim` Chrome 会话，完成后清理；未提交或推送。
