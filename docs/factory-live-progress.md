# 动态流转大屏：当前状态

## 2026-09-17：八班组待接收转料（已部署）

前后端 `20260917T094309Z` 已上线，程序提交 `68cfb0e`。入口为 `http://122.200.93.68:8082/factory-live`。前端全量438项通过，线上材质件数/重量、八班组转料及三路SSE核验通过；原业务数据和MySQL容器不变，备份及回退说明见 [服务器部署](server-deployment.md)。下列专项记录保留开发期验证过程。

- 顶部显示“全厂在库 + 具体材质在库”，两者及在途提示均同时显示 **件数 / 重量（kg）**，不只显示重量。完整材质名称/牌号分别汇总，例如铜钼 CuMo70、铜钼 CuMo50 不合并，不使用半成品/成品等性质分类。每次显示三种材质，每 **2 秒向上切换下一组**，末组不足三种不重复补齐；全厂总量固定，支持手动翻页。左右转料列表仍显示每条记录的件数与重量、持续匀速滚动，两者节奏独立。暂停按钮暂停两处自动播放，不停止实时数据推送。
- 件数补全追加验证：前端相关55项、TypeScript及生产构建通过；覆盖每个班组每条可见流转的双数值、零件数、小数重量及推送更新。独立Chrome检查2K与390px窄屏，截图为 `output/playwright/robot-quantity-weight-2k.png`、`robot-quantity-weight-mobile.png`。接口本来已返回件数，此次只补前端显示，不改后端计算或业务数据。
- 新增 `material_stock` 响应字段，复用各班组实物库存余额，包含仍在库的废料、不含内部在途；确认外部出库及丢失后扣减，历史未纳入库存记录不混入。未填写材质单独归组，全部材质均可轮播，不截取前八名。沿用 SSE 提交后推送，不增加轮询或数据库字段。
- 材质轮播专项：后端50项、前端54项、TypeScript和生产构建通过。独立Chrome实测2K稳定换页间隔约2秒、翻页按钮位置不跳动，左右转料持续移动；390px窄屏换页区保持等高，无横向溢出。截图为 `output/playwright/robot-materials-2k.png`、`robot-materials-page-2k.png` 和 `robot-materials-mobile.png`。以上为发布前专项检查，后续已随本节版本部署。
- 以 `docs/design/factory-live-pending-selected.png` 为确认稿：两侧各四组、等宽等高、设备与组名镜像排列；机器人、原工厂背景及独立全屏入口保留。不显示底部列表、播报带、库存卡或流转箭头。
- 每组固定表头“流水号 / 来源班组 / 件数与重量”，三行高度的显示窗口。来源为上序，所在分区为接收班组。依最新要求改为持续匀速上移，速度为32设计像素/3秒，中途不停顿，首尾循环；每组仅挂载四行（含底部进入缓冲行），不整批复制记录。三条以内静态展示。点击组名切换当前班组，点击流水号进入对应 CK/TL 明细。鼠标悬停、焦点停留和点击组名不自动暂停；顶部按钮支持原位置暂停续播，仍保留页面隐藏及系统减少动态效果保护。
- `/api/factory-overview/live` 的班组增加 `pending_transfers`：仅内部转料且仍待接收；按接收班组、转料单、流水号聚合。同一 CK 多流水号分别显示各自件数和重量，同一流水号多来源明细合并；部分接收只显示剩余待接收数量。每班组取最近 100 条，不受其他班组占满全局列表影响。已接收、作废、手工入库和对外出库不进入此列表。
- 保留 SSE 实时推送，未增加轮询。暂停轮播不暂停数据更新；收到接收/作废后的新快照立即移除对应记录。机器人跟随当前选中班组的第一条可见转料，批次、流水号或更新时间变化触发动作；原三维模型、骨骼及材质未替换。
- 初次验证：前端全量55文件431项、后端相关46项通过。连续滚动追加验证：前端相关41项、TypeScript及生产构建通过；独立Chrome 2K测得连续移动10.54–11.25设计像素/秒，覆盖行衔接、原位暂停续播、悬停和组名点击不停及机器人继续运动，截图为`output/playwright/robot-continuous-2k.png`。本次未重跑全量前后端套件。没有使用内置浏览器，没有修改线上业务数据。
- 本次已一并更新前后端；接口为新增字段，不需数据库迁移。详细画面对照见根目录 `design-qa.md`。

## 历史上线记录

2026-09-12。已部署至 `http://122.200.93.68:8082/factory-live`，前后端版本 `20260912T145538Z`。原工厂背景与独立大屏入口保留，最新统一内部转料“提交即扣上序库存、未接收计在途”口径。上一版按截图清理五个旧 DEMO 班组；本次未改写任何业务记录。

## 2026-09-12 实施说明

本轮按用户认可的转料表效果图落地，并落实最后两项修改：移除机器人周围全部流转连线；机器人跟随转料表当前显示的第一条记录。白色圆头、黑面罩、青色眼睛及双手持料盘的真实三维机器人保留。

不是整张图片浮动。Three.js 加载 CC0 骨骼及动作，圆角外壳、面罩、关节和托盘以真实三维网格渲染。递料通过双臂 IK 保持手掌在托盘下方，每次动作约5秒；不再由机器人自己的8秒计时器重播，也不再显示手动演示按钮。首条批次号、状态或更新时间变化触发递料，同一批次未变化的刷新不重复触发。机器人、班组上/下序高亮、摘要和播报共享表格首条数据。

RAF 上限30 FPS，画布精度随显示缩放和设备像素密度调整，最多225万像素、单边4096；页面隐藏、阅读、暂停、减少动态效果及请求失败都会暂停动作。离开页面释放 WebGL 上下文。

## 已实现与验证

- 独立页面 /factory-live，位于业务布局之外，不显示后台侧栏或顶栏；原 / 全厂统计总览保留。点击后台“大屏展示”同步请求浏览器全屏，直接输入 URL 或浏览器拒绝全屏时仍为独占页面，可点击大屏全屏按钮进入。返回系统时退出全屏并恢复业务布局，原访问锁和登录验证不变。
- 库房、轧制、退火、研磨、线切割、雕刻、电镀、检验共八个班组；独立设备图片。
- 深蓝工厂场景背景、四项指标、八班组、动态机器人、整行文字播报、Element Plus转料表。恢复原 factory-background.png 与中央平台，窄屏仅机器人区域使用背景；文字区加半透明衬底。库存条、装饰性边框动效及机器人周围的流转连线仍不显示。
- 首屏显示8条，来自最近100条真实整批记录；每8秒前移一条，尾部回到开头，无重复补齐。底部明确写“最近100条”，不假装覆盖全部历史记录；业务列表仍保持20/50/100分页。
- 表格包括批次号、上序/下序、材质、去重流水号数、件数、重量、状态、最长未接收时长。多材质汇总显示种数，明细点击查看；等待时间以仍待接收明细的最早创建时间计算，不以最近编辑时间重置。
- 指标为当前在库（另示内部在途重量）、今日转出、待交接、今日已接收。“待交接”包含内部接收和对外出库确认，不能误称全部为待接收。内部转料提交即扣上序在库并计入在途，接收时只增加下序在库；今日内部转出按提交时间、对外出库按确认时间，接收按确认时间及完整CK去重，部分确认不虚增已完成批次数。
- 30秒刷新；暂停或阅读时暂存刷新结果，恢复后应用。完整批次/班组台账/旧统计总览入口可用。
- 本轮全量前端314项、类型检查及生产构建通过。独立Chrome检查2K 2560×1440、1366×768及390×844，验证点击入口直接原生全屏、直接打开无后台布局、返回恢复业务布局及画布释放；控制台0错误、0警告。此前首条联动、悬停冻结、系统减少动态效果、打开真实批次详情和WebGL释放已实测，后端153项通过；本轮未改后端业务代码或重跑完整后端套件。按用户要求不测试4K。
- 本地业务数据仍为 433 条转料、376 张出库单、192 条丢失记录。
- 最新库存口径回归：159 项后端、315 项前端及生产构建通过；上线前后 MySQL 逐表摘要不变，班组库存、流水号、图表和大屏查询一致。在库 1,733.4 kg，内部在途 164.8 kg，合计 1,898.2 kg，没有丢失或重复入账。

## 视觉素材

采用内置 ImageGen。当前选定效果图：design/factory-live-table-selected.png；原效果图design/factory-live-selected.png保留。用户明确要求不实现新图中的流转曲线，其余按现有可动机器人和真实业务数据落地。
素材目录：../frontend/public/assets/factory-live/。所有图片保持生成的原始 PNG，未用 Python 图像处理。

共同生成要求：参考选定效果图，独立高质量 3D 工业设备插图，青色轮廓光，深蓝银色材质，无文字、界面或水印；有 alpha 的图片保持 alpha，其余明确使用 #00111d 深蓝底，禁止烘焙棋盘格。

最终提示词中的主体规范：

- warehouse.png：compact dark gray metal warehouse, cyan roof trim, open loading door glowing amber, stacked cardboard shipping boxes, isolated isometric view。
- rolling.png：two substantial rolled steel sheet coils with concentric layers and deep cylindrical bodies on a small rolling conveyor stand, not flat grinding wheels。
- annealing.png：dark graphite industrial box annealing furnace, open orange glowing arched chamber, attached left control cabinet。
- grinding.png：two thin brushed-silver grinding discs with small spindle holes, one upright and one flat on a small navy support, not broad wound coils。
- wire-cut.png：asymmetric blue-gray C-upright wire EDM, prominent brass spool, thin vertical cutting wire, workpiece and open dielectric tank; no spindle or gantry。
- engraving.png：wide low-bed orange gantry CNC engraving router, silver downward spindle, broad T-slot bed and engraved metal plate; no EDM spool, wire or water tank。
- plating.png：three polished stainless cylindrical tanks on one rectangular pipe frame, tall blue electrode supports, overhead pipes and copper rods。
- inspection.png：white/silver optical measurement rig, black optical head, measurement table, adjacent small cyan technical monitor without readable text。
- robot.png：white/silver rounded helmet robot, glossy black visor with cyan smiling eyes, both hands holding stainless tray of machined parts; solid #00111d background; no platform or UI。此图片仅为造型预览，不能冒充可动模型。
- factory-background.png：symmetrical dark navy cinematic factory conveyors; empty cyan-lit tiered pedestal at lower center; no robot, UI, text or route overlays。

## 三维模型来源

design/robot-expressive-rejected.glb 保留原文件作历史存档；运行时副本位于 ../frontend/public/assets/factory-live/robot-expressive.glb。原低多边形表面不显示，只复用骨架与动画，外壳按照本轮认可的圆头方向细化。
来源：https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive
作者 Tomás Laulhé (Quaternius)，Don McCurdy 修改，CC0 1.0。来源与许可已记录在 frontend/THIRD_PARTY_NOTICES.md。

## 最终证据

- 当前最终全图：../output/playwright/live-standalone-20260912/01-standalone-2k.png；一键全屏：02-one-click-fullscreen.png；笔记本：03-laptop.png；手机：04-mobile.png。该目录截图来自本地同一发布产物；线上另做资源与接口核验。
- 动作状态：flow-table-moving.png；普通窗口：flow-table-window.png；手机：flow-table-mobile.png、flow-table-mobile-feed.png。
- 已修复首轮网格默认最小高度导致班组栏遮挡播报的问题，前后证据分别为flow-table-pass1.png / flow-table-pass2.png。
- 根目录 design-qa.md 记录本轮验证。旧统计大屏保留，独立Chrome会话已完整关闭。部署与定向演示数据清理的备份、范围见 docs/server-deployment.md。
