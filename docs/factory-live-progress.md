# 动态流转大屏：当前状态

2026-09-12。已部署至 `http://122.200.93.68:8082/factory-live`，前后端版本 `20260912T145538Z`。原工厂背景与独立大屏入口保留，最新统一内部转料“提交即扣上序库存、未接收计在途”口径。上一版按截图清理五个旧 DEMO 班组；本次未改写任何业务记录。

## 当前结论

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
