# 登录页设计验收 · 2026-09-27

**Findings**

登录页按已选定的金属场景、玻璃面板及简洁文案实现，业务接口沿用现有账号体系。常规视口和登录交互通过；后续补查发现超宽屏的布局比例及高分屏背景精度仍需完善（P2），不能视作所有显示屏均已适配。

## 比对依据与证据

- 原始选定设计：`/Users/zhangsen/.codex/generated_images/01a07558-9ffb-7873-b4e0-f72f726f80bb/exec-1647b4db-cdfb-4458-b3d3-9ea8a9fcc058.png`。
- 工作区参考副本：`output/playwright/login-redesign-reference.png`。
- 实现：`http://127.0.0.1:15186/login`，`frontend/src/pages/LoginPage.vue` 与 `frontend/src/styles/auth.css`。
- 最新桌面静态与悬停截图：`output/playwright/login-hover-rest.png`、`output/playwright/login-hover-active.png`（无损背景、纵向加长表单和鼠标掠光）。
- 最新收紧前后比对：`output/playwright/login-compact-comparison.png`；原图还原比对归档：`output/playwright/login-redesign-comparison-final.png`。
- 同一区域 1:1 表单合并比对：`output/playwright/login-redesign-form-comparison.png`。
- 原图还原阶段的参考图与比对截图均为 1584 × 993；最新静态及悬停截图为 CSS 视口 1440 × 900，deviceScaleFactor 1。完整比对缩略图等比缩小，表单裁切保持原始像素。
- 状态：未登录、空表单、账号焦点、浅色、进入动画完成。使用单个独立 Chrome 自动化会话；没有使用 Codex 内置浏览器。

## 必检面

1. **字体**：沿用现有 HeatSink Inter / PingFang SC / Microsoft YaHei 字体栈。标题为两行真实文字；1584px 视口主标题约 69px、表单标题 34px；表单标题桌面 28–34px、手机 26px，输入文字 16px。没有栅格化文字、截断或错行。
2. **布局**：品牌左上、产品左下、右侧玻璃表单。桌面表单为 32vw、最小 360px、最大 480px；按最新反馈，在高度至少 701px 的桌面视口增加上下留白和字段间距，形成更修长的比例。1440 × 900 视口中约 461 × 547px，1280 × 720 中约 410 × 502px；1024 × 600 保持紧凑，约 360 × 431px。上述桌面视口均一屏容纳；390、320 宽度保持上下布局。320 × 640 显示校验错误后按钮仍在视口内；短视口可滚动页面而不滚动玻璃面板内部。
3. **颜色**：灰绿背景、深绿标题、玉绿色按钮 `#205c48`；真实半透明面板和 backdrop-filter；焦点描边、错误红字及加载状态可辨认。
4. **图像**：使用从选定图生成的独立金属场景无损 WebP，1584 × 993、1,055,850 字节；解码像素与源 PNG 完全一致，没有使用整页图片替代表单。官方 logo 原图与比例保留。金属层叠、立板位置、铜边及光照接近参考。
5. **文案**：名称统一为“热沉事业部综合管理系统”；页面只显示公司标识、系统名、系统登录、账号、密码、登录，以及操作时必要的加载或错误提示。无欢迎语、重复页脚或功能口号。浏览器标题和侧栏无障碍名称同步更新。

## 比对与修复历史

- 第一轮 `login-redesign-comparison-v1.png`：发现全局主题覆盖按钮颜色、图标和输入文字偏小、表单间距偏紧（P2）。调整登录页局部主题变量、控件字体和间距，补上始终可见且支持键盘操作的密码显隐按钮。第二轮及最终截图确认修复。
- 交互轮：键盘聚焦会让带掠光伪元素的 `overflow: hidden` 面板产生内部滚动并遮住标题（P1）。改用 `overflow: clip`；复测聚焦、加载、错误、密码显隐后 `scrollTop=0`，标题保持在面板内。修复后证据：`login-redesign-error.png`、`login-redesign-loading.png`、`browser-check.log`。
- 最终重新截图并打开完整和局部合并比对；剩余差异见下方 P3。
- 用户反馈背景偏糊后，发现原有 55 KB 有损编码抹去了金属表面细纹（P2）。改用无损编码，保持原生尺寸、构图和布局；逐像素检查与源 PNG 一致。独立 Chrome 在 1584 × 993 视口确认背景 opacity=1、filter=none、无横向溢出。前后局部比对：`output/login-redesign/clarity-comparison-after.png`；像素检查：`output/login-redesign/clarity-image-check.log`。此修复恢复源图细节，不增加原图分辨率。
- 清晰度修复后，生产构建与 TypeScript 检查通过（`output/login-redesign/clarity-build.log`），构建产物与无损背景文件完全一致；临时 Chrome 会话已关闭，所属进程确认退出。
- 用户反馈登录框偏大后，收紧桌面卡片、标题、控件和间距，保留玻璃效果与背景。8 个视口检查无横向溢出，表单内部 scrollTop=0，手机错误状态按钮可见。证据：`output/login-redesign/compact-browser-check.log`、`output/playwright/login-compact-*.png`。
- 收紧后生产构建、TypeScript 及 `git diff --check` 通过（`output/login-redesign/compact-build.log`）；临时浏览器会话关闭且所属进程确认退出。
- 按用户最新要求纵向加长桌面卡片并增加鼠标动画：1440 × 900 高度由 483px 增至 547px，宽度不变。悬停时独立位移上浮 4px、边框及阴影渐亮，反光 1.1 秒扫过一次；离开复位，重新移入可重播。由未位移的外层触发悬停，鼠标停在底边时不会反复触发。证据：`output/login-redesign/hover-browser-check.log`、`hover-edge-check.log`、`output/playwright/login-hover-*.png`。
- 此轮 TypeScript、生产构建和最终 CSS 构建通过（`output/login-redesign/hover-build.log`、`hover-vite-final.log`），`git diff --check` 通过；触屏、减少动态效果及边缘悬停复测通过。临时 Chrome 会话已关闭，所属进程确认退出。

## 功能和动态验证

- 发布状态：前端 `20260926T175302Z` / 程序 `f94700e` 已上线，发布前隔离源码 75 文件 / 545 项测试、ESLint、格式、TypeScript 和构建通过。服务器及公网资源、入口、鉴权和健康核验通过；本次部署未新增浏览器视觉检查。记录见 `docs/server-deployment.md`，发布证据在 `output/deploy/login-20260927/`。
- 相关自动化测试 39 项通过（登录、导航、访问保护）；生产构建、TypeScript、修改文件 ESLint、`git diff --check` 通过。
- 独立本地 SQLite 后端验证：空账号不发送请求；错误密码显示服务端错误；加载期间输入和按钮禁用；密码可用键盘切换显示；密码框回车成功登录；一失败一成功共两个登录请求，没有重复提交。
- 管理员正常进入 `/`；单元测试覆盖内部返回地址、外部地址拒绝及班组默认工作台。
- 背景淡入 1000ms，品牌和面板进场 700ms；鼠标悬停浮起与阴影过渡 320ms，玻璃掠光单次 1100ms。触屏关闭悬停效果；减少动态效果时无位移、无掠光，活动动画数为 0。成功登录采用浏览器 View Transition，降级时正常导航。
- 浏览器脚本异常 0。错误密码产生的预期 401 属于验证场景。
- 证据：`output/login-redesign/tests.log`、`build.log`、`browser-check.log`、`responsive-motion-check.log`；`output/playwright/login-redesign-*`。
- 使用本地测试账号和隔离数据库；没有测试或改写线上业务数据。
- 任务创建的 Chrome 会话及进程已关闭并核对退出；仅保留本地预览服务供检查。

**Open Questions**

无阻塞问题。

**Implementation Checklist**

- [x] 真实组件还原登录页与名称。
- [x] 生成、压缩并接入独立背景资产。
- [x] 接入进场、掠光、输入与按钮反馈、成功过渡及减少动态效果。
- [x] 检查桌面、平板、手机、短视口与真实登录流程。
- [x] 修复主题覆盖和键盘引发的面板滚动，复测并留存证据。

**Follow-up Polish**

- P2：此前 3440 × 1440 超宽屏、3840 × 2160 原生 CSS 视口检查发现整体相对画面偏小且品牌与表单分隔过远。此次按用户反馈收紧常规屏幕上的表单，没有处理超宽屏构图，仍需单独完善。
- P2：在 1920 × 1080、deviceScaleFactor=2 的 Chrome 上，真实文字和控件正常；1584 × 993 背景需放大到高密度输出，仍有原图分辨率限制。无损编码修复了压缩损失，但不等同于原生 4K 背景。
- 收紧后短视口复测：1024 × 600 已无纵向溢出；900 × 600 采用上下布局，需纵向滚动 72px。未发生横向溢出。证据：`output/login-redesign/compact-browser-check.log`；之前超宽屏和高分屏检查归档：`output/login-redesign/screens-final.log`、`output/playwright/login-screen-before-contact.png`、`output/playwright/login-screen-retina-1920x1080.png`。均为独立 Chrome 模拟视口，非全部实体设备实测。
- P3：图稿中的玻璃折射和按钮局部光斑属于渲染效果；实现使用真实背景模糊、边缘高光、阴影及动态掠光，光影不会逐像素相同。图标使用现有 Element Plus 图标库，其轮廓略细于生成图。
- 本次浏览器实测为桌面 Chrome 及其响应式视口，未实测实体手机浏览器。

final result: common viewport checks passed; ultrawide layout and high-density background need improvement
