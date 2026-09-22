# 安泰天龙官方标识

按用户要求于 2026-09-22 从[安泰天龙官网](https://www.atm-tungsten.cn/)取得原始图片。保留原色、透明背景和原始比例，不重绘、不裁切、不添加滤镜。

| 项目文件 | 官方来源 | 规格 |
| --- | --- | --- |
| `frontend/public/brand/attl-official-logo.png` | [官网页首标识](https://omo-oss-image.thefastimg.com/portal-saas/ngc202208100001/cms/image/4742a428-a607-4469-b086-67be7f6337ab.png) | PNG，1017 × 143，16,425 字节 |
| `frontend/public/brand/attl-official-favicon.ico` | [官网浏览器图标](https://www.atm-tungsten.cn/favicon.ico) | ICO，32 × 32，4,286 字节 |

完整标识用于展开的侧边栏及登录页；小图标用于收起的侧边栏和浏览器标签。图片随项目本地发布，不热链官网。系统名称、白紫主题、业务页面、大屏和纯锁访问验证界面不变。

原图 SHA-256：

- PNG：`24607f2433ce7b89d52c5163c5c47827cf9545c956eb656f9898080d6b61cb8a`
- ICO：`19791b825d5c2ea05351de9d45506cf0329558465dab911517eb61fa57b52377`

这些文件是第三方企业标识，并非项目原创或开源图标；本次按用户要求用于安泰天龙相关系统的品牌展示，商标及图片权利归其权利人所有。

## 本地验证

访问保护、导航及侧栏共 13 项测试通过，修改文件 ESLint、TypeScript 检查及生产构建通过。构建内两张标识的 SHA-256 与官网下载原文件一致。独立 Chrome 核对 1440px 桌面登录页、390px 手机登录页和侧栏展开/收起状态；检查后关闭临时浏览器及演示服务，未操作线上数据。标识及登录页随后已随 `20260922T100012Z` 发布，详见 [部署记录](server-deployment.md)。
