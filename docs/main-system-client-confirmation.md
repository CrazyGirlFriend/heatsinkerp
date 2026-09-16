# 主系统对接接口确认单（提交甲方）

日期：2026-09-15　版本：讨论稿 v1.0

请贵方协助确认以下两个接口：**服务鉴权、按流水号查询资料**。接口由贵方主系统提供，我方物料流转系统后端调用，不要求操作人员重复登录主系统。

以下地址、认证参数和返回结构均为建议约定，不表示贵方已有接口，也不表示我方已经实现自动获取令牌。若贵方已有接口，请提供实际接口文档、脱敏请求/响应示例，我们据此适配。真实凭证请通过双方认可的安全渠道交付，不填写在本文件中。

## 一、服务鉴权：获取访问令牌

用途：主系统识别我方系统身份，并授予指定组织/工厂内的流水号资料只读权限。

**建议接口：** `POST /api/integration/v1/auth/token`

### 请求示例

```http
POST /api/integration/v1/auth/token
Content-Type: application/json
Accept: application/json
X-Request-ID: <本次请求的UUID>
```

```json
{
  "client_id": "<贵方分配的系统标识>",
  "client_secret": "<贵方分配的系统密钥>"
}
```

| 请求字段 | 含义 | 必填 |
| --- | --- | --- |
| client_id | 贵方分配给我方系统的专用身份标识，不是员工账号 | 是 |
| client_secret | 对应该身份的系统密钥，仅由后端保存和使用 | 是 |

这是建议的自定义 JSON 鉴权协议，不宣称符合 OAuth。若贵方采用 OAuth、AppKey 签名、证书或直接签发固定令牌，请以贵方规范为准，不强行套用上述参数。

### 成功返回示例（HTTP 200）

```json
{
  "access_token": "<用于查询资料的访问令牌>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

| 返回字段 | 类型 | 含义 |
| --- | --- | --- |
| access_token | string | 非空访问令牌；不得包含空格、换行 |
| token_type | string | 建议固定为 Bearer |
| expires_in | integer | 从令牌签发起计算的有效秒数，正整数；3600 仅为示例，实际由贵方确认 |

令牌响应应使用 `Cache-Control: no-store`。建议令牌到期前通过本接口重新获取，避免新增第三个刷新接口；我方收到查询接口 401 后最多重新获取一次并重试一次查询，持续失败应明确报错。上述自动续期是待实现的对接要求，当前我方仅支持配置已有 Bearer Token。

### 错误约定

| HTTP 状态码 | 含义 |
| --- | --- |
| 400 | 请求参数缺失或格式错误 |
| 401 | 系统标识或密钥无效 |
| 403 | 系统身份被停用，或不允许使用本接口 |
| 429 | 请求频率超限 |
| 500 / 503 | 主系统服务异常或暂不可用 |

错误示例（不返回密钥、令牌或内部堆栈）：

```json
{
  "code": "INVALID_CLIENT",
  "message": "系统凭证无效",
  "request_id": "<本次请求的UUID>"
}
```

### 请甲方确认

- 实际鉴权方式、接口地址、请求方法、参数位置及字段名是什么？
- 能否提供专用系统凭证？令牌有效期、续期、密钥更换和吊销规则是什么？
- 同时获取多个令牌是否相互失效？允许访问哪些组织/工厂？
- 是否要求出口 IP 白名单、签名、时间戳或其他请求头？请求频率限制是多少？

## 二、按流水号查询资料

用途：我方输入或扫描流水号后，获取该流水号的客户与物料信息，用于详情展示及纸质转料单。**查询不代表入库，不扣减主系统库存，也不创建转料记录。**

**建议接口：** `GET /api/integration/v1/serial-materials`

本期按完整流水号精确查询，返回一条对象；不做模糊搜索、候选列表或分页。若同一流水号可能对应多个物料明细或多个组织，请贵方说明唯一标识与实际结构，双方确认后调整，不能任意取第一条。

### 请求示例

```http
GET /api/integration/v1/serial-materials?serial_no=001-A
Authorization: Bearer <鉴权接口返回的access_token>
Accept: application/json
X-Request-ID: <本次请求的UUID>
```

| 请求字段 | 位置 | 类型 | 说明 |
| --- | --- | --- | --- |
| serial_no | URL 查询参数 | string | 必填，1～80 字符，保留前导零、大小写及内部符号；使用标准 URL 编码 |
| Authorization | 请求头 | string | 必填，Bearer 加一个空格，再加访问令牌 |

### 成功返回示例（HTTP 200）

```json
{
  "schema_version": "1.0",
  "serial_no": "001-A",
  "revision": "17",
  "updated_at": "2026-09-15T08:30:00+08:00",
  "active": true,
  "document": {
    "material_name": "铜钼 CuMo70",
    "material_type": "semi_finished",
    "source_batch_no": "RAW-001",
    "finished_specification": "30×20×2 mm",
    "transfer_specification": "32×22×2 mm",
    "finished_quantity": 500,
    "customer_code": "C-001",
    "technical_requirements": "按图纸交付",
    "product_code": "P-001",
    "part_no": "J-001",
    "material_shape": "片",
    "material_description": "散热物料",
    "outsourced_unit": null,
    "purpose_category": "散热",
    "category_level3": "钼铜片",
    "order_category": "正式订单",
    "special_process": "表面清洁"
  }
}
```

### 返回的流水号身份信息

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| schema_version | string | 接口结构版本，本稿固定 1.0 |
| serial_no | string | 查询对应的完整流水号，必须与请求一致 |
| revision | string | 主系统资料版本，1～100 字符；资料或启停状态改变时必须变化 |
| updated_at | string | 主系统资料更新时间，ISO 8601 格式且带时区 |
| active | boolean | 是否启用；false 可查阅，但不允许据此新增入库 |
| document | object | 下表所列客户与物料资料 |

### 返回的客户与物料资料（17 项）

所有字段键都保留；材质必须非空，其余资料没有值时返回 `null`。请贵方逐项确认能否提供、主系统对应字段名和业务含义。不能用 0 代替未知件数。

| 字段 | 中文名称 | 类型及最大长度 | 说明 |
| --- | --- | --- | --- |
| material_name | 材质 | string，160 字符 | 必须非空，例如铜钼 CuMo70 |
| material_type | 物料类型 | string / null | 建议分类，实收分类由库房确认 |
| source_batch_no | 原单批号 | string / null，80 字符 | 主系统原单批号，不是我方转料批次号 |
| finished_specification | 成品规格 | string / null，240 字符 | 建议带尺寸单位 |
| transfer_specification | 转料规格参考值 | string / null，240 字符 | 请确认是否属于该流水号的固定资料 |
| finished_quantity | 成品件数 | integer / null | 0～2147483647；主系统件数，不是本次实收或转出件数 |
| customer_code | 客户代码 | string / null，80 字符 | 该流水号对应客户 |
| technical_requirements | 技术要求 | string / null，4000 字符 | 用于详情和纸质转料单 |
| product_code | 编号 | string / null，80 字符 | 请确认主系统中“编号”的实际含义 |
| part_no | 件号 | string / null，80 字符 | 保留前导零等原始内容 |
| material_shape | 形状 | string / null，80 字符 | 如片、棒等 |
| material_description | 物料说明 | string / null，2000 字符 | 主系统物料说明 |
| outsourced_unit | 外委单位 | string / null，160 字符 | 无外委时为 null |
| purpose_category | 用途分类 | string / null，80 字符 | 显示文字，需确认字典含义 |
| category_level3 | 三级类别 | string / null，80 字符 | 显示文字，需确认字典含义 |
| order_category | 订单分类 | string / null，80 字符 | 显示文字，需确认字典含义 |
| special_process | 特殊工艺说明 | string / null，2000 字符 | 仅展示/打印，不驱动本期工艺流程 |

`material_type` 建议枚举：`finished` 成品、`semi_finished` 半成品、`finished_surplus` 成品余料、`semi_finished_surplus` 半成品余料、`defective` 不良品、`waste` 废料、`sludge` 泥料、`scrap_chips` 屑料。若贵方已有代码字典，请提供映射，不要求贵方修改既有业务分类。

### 错误约定

| HTTP 状态码 | 含义 |
| --- | --- |
| 400 | 流水号缺失或格式错误 |
| 401 | 令牌无效或过期 |
| 403 | 令牌有效但无对应资料读取权限 |
| 404 | 未找到该流水号，不返回空对象或虚构资料 |
| 429 | 请求频率超限 |
| 500 / 503 | 主系统服务异常或暂不可用 |

错误正文沿用鉴权接口的 `code`、`message`、`request_id` 结构。失败使用真实 HTTP 错误码，不能用 200 包裹错误。已存在但停用的流水号返回 200 和 `active:false`。

## 三、共同约定与待交付资料

- 两个接口均通过后端 HTTPS 调用，验证服务端证书，不跳转登录页，不将凭证放进 URL。贵方无须接收我方用户登录密码。
- 查询成功返回 UTF-8 JSON 对象，不额外套 `data` / `result`。本稿结构与我方当前查询适配器一致；如果贵方格式不同，请先提供样例，我们确认映射后适配。
- 查询响应建议不超过 64 KiB。请确认超时与限流要求，并提供包含空值、停用状态及找不到流水号的样例。
- 同一流水号客户资料由主系统维护；我方入库时保留资料版本快照，后续转料沿用该批快照，不用主系统新资料覆盖历史单据。
- 我方自己记录转料批次号、条码、上序/下序、本次件数、重量、操作人、收发时间、确认状态及丢失记录，以上不要求主系统查询接口返回。
- 本期不包含向主系统回写入库、出库或库存变化。

**请甲方回复：** 测试及正式环境地址、两个接口的现有文档或对本稿的修改意见、凭证申请方式、权限/网络限制、上述 17 项字段映射及至少一个可用于联调的完整流水号样例。请特别确认流水号是否唯一对应一份资料，以及资料版本如何标识。

我方当前状态：已实现配置已有 Bearer Token 和按流水号查询的本地适配；本稿新增的自动获取/续期令牌协议仍待双方确认后开发，尚未与真实主系统联调。
