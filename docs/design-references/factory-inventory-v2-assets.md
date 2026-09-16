# 已确认首页：素材记录

视觉基准：同目录 `factory-inventory-v2-selected.png`，即用户重新附上的
`exec-3935fd40-95a4-4da7-b57c-d7a66936d321.png`（1437×1095）。

2026-09-14 使用内置图片生成工具，按该图分别生成下列素材；不是把整张效果图当页面背景。
文件位于 `frontend/public/assets/factory-inventory/`，由 `FactoryInventoryPage.vue`
及 `InventoryAmbient.vue` 消费。旧资源保留，旧机器人大屏未改。

共同生成要求：参照已选图的等距工业设备造型，抛光半透明亚克力/玻璃材质，白色倒角高光，
冷色柔光，简洁单一主体，居中、占方形画布约 86%，真实透明底，无卡片、文字或水印。
设备输出均为 1254×1254 RGBA PNG，已经逐个打开检查；未进行手工绘图替代。

| 文件 | 主体与色彩 |
| --- | --- |
| warehouse-v2.png | 紫色三层仓储货架 |
| rolling-v2.png | 蓝色三辊轧制设备 |
| annealing-v2.png | 蓝色炉体，橙色发光炉口 |
| grinding-v2.png | 蓝色竖直研磨轮 |
| wire-v2.png | 蓝色线切割龙门与线轴 |
| engraving-v2.png | 紫色雕刻主轴、尖端与底座 |
| plating-v2.png | 青色电镀槽和吊杆 |
| inspection-v2.png | 青色检验屏和确认符号 |
| stock-v2.png | 紫色玻璃工业库存立方体 |

`ambient-v2.png` 为 1536×1024 RGB 背景：浅冰蓝与白底，少量宽幅蓝紫半透明波纹集中
顶部右侧，中央/下方保持安静，左下有轻微收尾；无粒子、文字、图标或界面内容。
使用图片本身呈现波纹，玻璃卡片用 CSS 填充、透明边缘和 backdrop-filter 表达表面材质。
已有 `transit.png` 蓝色卡车与本次图一致，直接复用。

实际库存、在途、流水号、待接收批次、加急数和更新时间均来自系统数据，继续通过 SSE 更新。
原图中的“10 秒自动更新”不保留，改为真实连接状态“实时同步”。
