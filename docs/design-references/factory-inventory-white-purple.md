# 首页白紫配色试样（2026-09-14）

用户要求“蓝紫不如白紫，做个白紫的出来”。沿用已确认首页的结构、字号、八种设备、
明细入口、实时推送和动效，只调整首页的大面积配色，不发布服务器。

底色 #faf9fd；主文字 #211a32；辅助文字 #70647f；汇总数字 #692ad6 / #8650c5。
玻璃卡片更偏白，阴影和反光换为低饱和紫色，待接收/加急继续保持原琥珀色语义。
少量蓝青色设备图标保留原稿识别性，没有为了换主题重绘全部设备。

后续浓淡微调：用户要求先淡一档，再在该版上降低三成。当前本地底色#fcfbfe，
装饰图层不透明度从第一档0.78降至0.546，侧栏白色覆盖从22%升至45.4%；
汇总紫色透明度为30.8%/22.4%、白色80.4%，卡片紫色透明度为16.8%。
只降低背景和表面紫色贡献，文字、数字、玻璃边缘、设备及功能不变；未部署线上。
最终实页为 `output/playwright/inventory-white-purple-20260914/10-lighter-30-desktop.png`，
前一档 `06-lighter-desktop.png` 和最初白紫 `01-desktop.png` 均保留用于对照。

新背景：[ambient-white-purple.png](../../frontend/public/assets/factory-inventory/ambient-white-purple.png)，
1536×1024，内置 imagegen 编辑原 `ambient-v2.png` 后保存为独立文件，原图未覆盖。
布局基准为 `output/playwright/inventory-selected-20260914/15-final-desktop.png`；
对照与实页证据位于 `output/playwright/inventory-white-purple-20260914/`。

最终生成 prompt（内置工具，无 CLI/API fallback）：

> Use case: style-transfer. Asset type: light web dashboard background image, edited color variant. Input image is the EDIT TARGET, not loose inspiration. Change ONLY its blue-purple palette to pearl WHITE and LAVENDER PURPLE. Preserve the same 1536x1024 3:2 landscape composition, the exact few broad translucent glass ribbon waves across the upper-right third and the small sweeping ribbon in the bottom-left corner, their curvature, location, white edge highlights, subtle glass illumination, and large empty central/lower area. Replace every ice-blue, sky-blue and cyan wash or ribbon tint with either clean near-white pearl or restrained pale-to-medium lavender violet. Main background approximately 80% near-white; visible tasteful lavender-purple color concentrated in top ribbons, with a very subtle lavender bottom-left ribbon. The purple must still be clearly visible, not washed out to plain white. Maintain restrained saturation and elegant airy glass material. No blue/cyan, no pink, no dark background, no extra waves, particles, shapes, text, UI, cards, objects, noise, logos or watermark. Keep everything except color unchanged.
