# 邻里互助 - 平台管理后台 API 接口文档

> **Base URL**: `http://localhost:3000/api/v1`
> **认证方式**: Bearer Token (JWT)
> **权限要求**: 所有接口需要 `ADMIN` 或 `SUPER_ADMIN` 角色

---

## 目录

1. [认证说明](#1-认证说明)
2. [任务类别管理](#2-任务类别管理)
3. [分账规则管理](#3-分账规则管理)
4. [分账计算引擎说明](#4-分账计算引擎说明)
5. [实战示例](#5-实战示例)

---

## 1. 认证说明

### 获取管理员 Token

```
POST /api/v1/auth/test-login
```

> 生产环境使用微信登录后，用户 `role` 为 `ADMIN` 或 `SUPER_ADMIN` 即可访问管理接口。

**请求体：**
```json
{
  "userId": "2"
}
```

**响应：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "..."
  }
}
```

### 请求头

所有管理接口需携带：

```
Authorization: Bearer <accessToken>
```

缺少 Token 或角色不足时返回：
```json
{ "statusCode": 403, "message": "需要管理员权限" }
```

---

## 2. 任务类别管理

> 用于管理小程序发布任务时的类别选项（跑腿、保洁、维修等）。
> 所有接口前缀：`/admin/task-categories`

### 2.1 创建任务类别

```
POST /admin/task-categories
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `code` | string | 是 | 类别编码（唯一），2-32 字符，如 `DELIVERY` |
| `name` | string | 是 | 类别名称，2-32 字符，如 `跑腿送货` |
| `icon` | string | 否 | 图标 URL，最长 256 字符 |
| `sort` | number | 否 | 排序值（升序），默认 0 |
| `isActive` | boolean | 否 | 是否启用，默认 `true` |

**示例：**
```bash
curl -X POST http://localhost:3000/api/v1/admin/task-categories \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "BEAUTY",
    "name": "美容美发",
    "icon": "https://example.com/icons/beauty.png",
    "sort": 9,
    "isActive": true
  }'
```

**成功响应 (200)：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "9",
    "code": "BEAUTY",
    "name": "美容美发",
    "icon": "https://example.com/icons/beauty.png",
    "sort": 9,
    "isActive": true,
    "createdAt": "2026-08-12T10:00:00.000Z",
    "updatedAt": "2026-08-12T10:00:00.000Z"
  }
}
```

**失败响应 (409) - 编码重复：**
```json
{
  "code": 409,
  "message": "类别编码已存在",
  "data": null
}
```

---

### 2.2 查询任务类别列表

```
GET /admin/task-categories?includeInactive=true
```

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `includeInactive` | boolean | 否 | 是否包含已停用的类别，默认 `false` |

**示例：**
```bash
curl http://localhost:3000/api/v1/admin/task-categories?includeInactive=true \
  -H "Authorization: Bearer <TOKEN>"
```

**响应：**
```json
{
  "code": 0,
  "message": "success",
  "data": [
    { "id": "1", "code": "DELIVERY", "name": "跑腿送货", "sort": 1, "isActive": true, "..." : "..." },
    { "id": "2", "code": "SHOPPING", "name": "代买代办", "sort": 2, "isActive": true, "..." : "..." },
    { "id": "3", "code": "CLEANING", "name": "家政保洁", "sort": 3, "isActive": true, "..." : "..." }
  ]
}
```

---

### 2.3 查询任务类别详情

```
GET /admin/task-categories/:id
```

**示例：**
```bash
curl http://localhost:3000/api/v1/admin/task-categories/1 \
  -H "Authorization: Bearer <TOKEN>"
```

---

### 2.4 更新任务类别

```
PATCH /admin/task-categories/:id
```

> `code` 字段不可修改，其余字段均可增量更新。

**请求体（所有字段可选）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 类别名称 |
| `icon` | string | 图标 URL |
| `sort` | number | 排序值 |
| `isActive` | boolean | 是否启用 |

**示例 - 停用类别：**
```bash
curl -X PATCH http://localhost:3000/api/v1/admin/task-categories/9 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }'
```

---

### 2.5 删除任务类别

```
DELETE /admin/task-categories/:id
```

> 若该类别下有关联任务，返回 409 禁止删除。

**示例：**
```bash
curl -X DELETE http://localhost:3000/api/v1/admin/task-categories/9 \
  -H "Authorization: Bearer <TOKEN>"
```

**成功响应：**
```json
{ "code": 0, "message": "success" }
```

**失败响应 (409) - 有关联任务：**
```json
{
  "code": 409,
  "message": "该类别下存在关联任务，无法删除，请改为停用",
  "data": null
}
```

---

## 3. 分账规则管理

> 用于动态配置平台与接单者的利润分成比例。
> 所有接口前缀：`/admin/profit-sharing-rules`

### 3.1 创建分账规则

```
POST /admin/profit-sharing-rules
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 规则名称，2-64 字符 |
| `categoryId` | string | 否 | 绑定的任务类别 ID（BigInt 字符串）。留空 = 全局默认规则 |
| `platformRate` | number | 是 | 平台抽成比例，0-1（如 `0.1` = 10%），最多 4 位小数 |
| `helperRate` | number | 是 | 接单者分成比例，0-1（如 `0.9` = 90%），最多 4 位小数 |
| `minPlatformFee` | number | 否 | 最低平台抽成（元），最少 0，最多 2 位小数 |
| `maxPlatformFee` | number | 否 | 最高平台抽成（元），需 >= `minPlatformFee` |
| `isActive` | boolean | 否 | 是否启用，默认 `true` |
| `validFrom` | string | 否 | 生效起始时间（ISO 8601），如 `2026-08-01T00:00:00.000Z` |
| `validTo` | string | 否 | 生效截止时间（ISO 8601），必须晚于 `validFrom` |
| `priority` | number | 否 | 优先级（整数），越大越先匹配，默认 0 |

**校验规则：**
- `platformRate + helperRate` 必须等于 1（误差 < 0.0001）
- `maxPlatformFee >= minPlatformFee`（如两者都提供）
- `validTo > validFrom`（如两者都提供）

**示例 1 - 创建全局默认规则：**
```bash
curl -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "全局默认规则",
    "platformRate": 0.1,
    "helperRate": 0.9,
    "priority": 0
  }'
```

**示例 2 - 创建类别专属规则（家政保洁 15%）：**
```bash
curl -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "家政保洁专属分账",
    "categoryId": "3",
    "platformRate": 0.15,
    "helperRate": 0.85,
    "priority": 10
  }'
```

**示例 3 - 带保底价和封顶价的规则：**
```bash
curl -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "跑腿保底规则",
    "categoryId": "1",
    "platformRate": 0.05,
    "helperRate": 0.95,
    "minPlatformFee": 5,
    "maxPlatformFee": 50,
    "priority": 5
  }'
```

**示例 4 - 限时活动规则（春节加价）：**
```bash
curl -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "春节跑腿活动抽成",
    "categoryId": "1",
    "platformRate": 0.08,
    "helperRate": 0.92,
    "validFrom": "2026-01-25T00:00:00.000Z",
    "validTo": "2026-02-10T23:59:59.000Z",
    "priority": 100
  }'
```

**成功响应 (200)：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "7",
    "name": "家政保洁专属分账",
    "categoryId": "3",
    "platformRate": 0.15,
    "helperRate": 0.85,
    "minPlatformFee": null,
    "maxPlatformFee": null,
    "isActive": true,
    "validFrom": null,
    "validTo": null,
    "priority": 10,
    "createdAt": "2026-08-12T10:00:00.000Z",
    "updatedAt": "2026-08-12T10:00:00.000Z"
  }
}
```

**失败响应 (400) - 费率之和不等于 1：**
```json
{
  "code": 400,
  "message": "platformRate + helperRate 必须等于 1",
  "data": null
}
```

---

### 3.2 查询所有分账规则

```
GET /admin/profit-sharing-rules
```

> 返回所有规则（含未启用的），按 `priority DESC, createdAt DESC` 排序，附带类别名称。

**示例：**
```bash
curl http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer <TOKEN>"
```

**响应：**
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "7",
      "name": "家政保洁专属分账",
      "categoryId": "3",
      "categoryName": "家政保洁",
      "platformRate": 0.15,
      "helperRate": 0.85,
      "minPlatformFee": null,
      "maxPlatformFee": null,
      "isActive": true,
      "validFrom": null,
      "validTo": null,
      "priority": 10,
      "createdAt": "2026-08-12T10:00:00.000Z",
      "updatedAt": "2026-08-12T10:00:00.000Z"
    },
    {
      "id": "1",
      "name": "全局默认规则",
      "categoryId": null,
      "categoryName": null,
      "platformRate": 0.1,
      "helperRate": 0.9,
      "minPlatformFee": null,
      "maxPlatformFee": null,
      "isActive": true,
      "validFrom": null,
      "validTo": null,
      "priority": 0,
      "createdAt": "2026-08-12T08:00:00.000Z",
      "updatedAt": "2026-08-12T08:00:00.000Z"
    }
  ]
}
```

---

### 3.3 查询分账规则详情

```
GET /admin/profit-sharing-rules/:id
```

**示例：**
```bash
curl http://localhost:3000/api/v1/admin/profit-sharing-rules/7 \
  -H "Authorization: Bearer <TOKEN>"
```

---

### 3.4 更新分账规则

```
PUT /admin/profit-sharing-rules/:id
```

> 全量更新。`UpdateProfitSharingRuleDto` 继承自 `CreateProfitSharingRuleDto`，所有字段均为可选。
> Service 层会二次校验 `platformRate + helperRate = 1`。

**请求体（所有字段可选，传什么改什么）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 规则名称 |
| `categoryId` | string | 绑定类别 ID，空字符串 = 改为全局规则 |
| `platformRate` | number | 平台抽成比例 |
| `helperRate` | number | 接单者分成比例 |
| `minPlatformFee` | number | 最低平台抽成 |
| `maxPlatformFee` | number | 最高平台抽成 |
| `isActive` | boolean | 是否启用 |
| `validFrom` | string | 生效起始时间 |
| `validTo` | string | 生效截止时间 |
| `priority` | number | 优先级 |

**示例 1 - 调整抽成比例（10% → 12%）：**
```bash
curl -X PUT http://localhost:3000/api/v1/admin/profit-sharing-rules/1 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "全局默认规则",
    "platformRate": 0.12,
    "helperRate": 0.88,
    "priority": 0
  }'
```

**示例 2 - 停用规则：**
```bash
curl -X PUT http://localhost:3000/api/v1/admin/profit-sharing-rules/7 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }'
```

**示例 3 - 修改保底价和封顶价：**
```bash
curl -X PUT http://localhost:3000/api/v1/admin/profit-sharing-rules/4 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "跑腿保底规则",
    "platformRate": 0.08,
    "helperRate": 0.92,
    "minPlatformFee": 3,
    "maxPlatformFee": 30,
    "priority": 5
  }'
```

**成功响应：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "1",
    "name": "全局默认规则",
    "categoryId": null,
    "platformRate": 0.12,
    "helperRate": 0.88,
    "minPlatformFee": null,
    "maxPlatformFee": null,
    "isActive": true,
    "validFrom": null,
    "validTo": null,
    "priority": 0,
    "createdAt": "2026-08-12T08:00:00.000Z",
    "updatedAt": "2026-08-12T10:30:00.000Z"
  }
}
```

---

### 3.5 删除分账规则

```
DELETE /admin/profit-sharing-rules/:id
```

> 删除后立即生效。新订单将不再命中此规则。
> 建议优先使用 `PUT` 停用（`isActive: false`）而非删除，以保留历史记录。

**示例：**
```bash
curl -X DELETE http://localhost:3000/api/v1/admin/profit-sharing-rules/7 \
  -H "Authorization: Bearer <TOKEN>"
```

**响应：**
```json
{ "code": 0, "message": "success", "data": { "success": true } }
```

---

## 4. 分账计算引擎说明

### 4.1 规则匹配优先级

当用户创建订单支付时，系统按以下顺序自动匹配分账规则：

```
① 类别精确匹配
   WHERE categoryId = 任务类别 AND isActive = true AND 当前时间在 [validFrom, validTo] 内
   ORDER BY priority DESC → 取第 1 条

② 全局默认匹配（如果步骤 ① 无结果）
   WHERE categoryId IS NULL AND isActive = true AND 当前时间在 [validFrom, validTo] 内
   ORDER BY priority DESC → 取第 1 条

③ 硬编码兜底（如果 ① ② 都无结果）
   platformRate = 10%, helperRate = 90%, ruleId = 'DEFAULT'
```

### 4.2 金额计算公式

```
platformFee = totalAmount × platformRate

if (minPlatformFee !== null && platformFee < minPlatformFee):
    platformFee = minPlatformFee        ← 保底

if (maxPlatformFee !== null && platformFee > maxPlatformFee):
    platformFee = maxPlatformFee        ← 封顶

platformFee = round(platformFee, 2)     ← 四舍五入到分
helperAmount = totalAmount - platformFee
```

### 4.3 计算示例

| 场景 | 总金额 | 规则 | 计算过程 | 平台抽成 | 接单者所得 |
|---|---|---|---|---|---|
| 全局默认 | 20元 | 10% | 20×0.1=2 | 2.00 | 18.00 |
| 保洁专属 | 50元 | 15% | 50×0.15=7.5 | 7.50 | 42.50 |
| 跑腿保底 | 30元 | 5%, min=5 | 30×0.05=1.5 → 保底5 | 5.00 | 25.00 |
| 辅导封顶 | 200元 | 20%, max=15 | 200×0.2=40 → 封顶15 | 15.00 | 185.00 |
| 精度测试 | 33.33元 | 10% | 33.33×0.1=3.333 → 3.33 | 3.33 | 30.00 |

### 4.4 金额守恒定律

```
totalAmount = platformFee + helperAmount  （恒等式）
```

所有场景下，平台抽成 + 接单者所得 = 订单总金额。

---

## 5. 实战示例

### 5.1 完整操作流程：配置春节活动分账

```bash
# 步骤 1: 获取管理员 Token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/test-login \
  -H "Content-Type: application/json" \
  -d '{"userId":"2"}' | jq -r '.data.accessToken')

# 步骤 2: 查看现有规则
curl -s http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer $TOKEN" | jq

# 步骤 3: 创建春节活动规则（跑腿类别，限时降低平台抽成至 5%）
curl -s -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "春节跑腿优惠活动",
    "categoryId": "1",
    "platformRate": 0.05,
    "helperRate": 0.95,
    "validFrom": "2026-01-25T00:00:00.000Z",
    "validTo": "2026-02-10T23:59:59.000Z",
    "priority": 100
  }' | jq

# 步骤 4: 验证规则已创建
curl -s http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, name, platformRate, validFrom, validTo, priority}'

# 步骤 5: 活动结束后停用规则（而非删除）
curl -s -X PUT http://localhost:3000/api/v1/admin/profit-sharing-rules/<RULE_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }' | jq
```

### 5.2 为不同类别设置差异化抽成

```bash
# 家政保洁 - 高抽成（平台提供质量保证）
curl -s -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "家政保洁分账",
    "categoryId": "3",
    "platformRate": 0.15,
    "helperRate": 0.85,
    "minPlatformFee": 3,
    "priority": 10
  }'

# 跑腿送货 - 低抽成（高频低额）
curl -s -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "跑腿送货分账",
    "categoryId": "1",
    "platformRate": 0.08,
    "helperRate": 0.92,
    "minPlatformFee": 1,
    "maxPlatformFee": 20,
    "priority": 10
  }'

# 学业辅导 - 高封顶（高额订单限制平台收益）
curl -s -X POST http://localhost:3000/api/v1/admin/profit-sharing-rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "学业辅导分账",
    "categoryId": "5",
    "platformRate": 0.2,
    "helperRate": 0.8,
    "maxPlatformFee": 50,
    "priority": 10
  }'
```

### 5.3 审计日志

所有写操作（创建/更新/删除）会自动写入 `audit_logs` 表，记录：

| 字段 | 说明 |
|---|---|
| `admin_id` | 操作管理员 ID |
| `action` | `CREATE` / `UPDATE` / `DELETE` |
| `target_type` | `TASK_CATEGORY` / `PROFIT_RULE` |
| `target_id` | 操作目标 ID |
| `detail` | 变更内容 JSON |
| `ip` | 操作者 IP 地址 |

---

## 附录：统一响应格式

所有接口遵循统一响应结构：

```json
{
  "code": 0,         // 0 = 成功, 非 0 = 业务错误码
  "message": "success",
  "data": { ... }    // 成功时返回数据, 失败时为 null
}
```

### 错误码对照

| HTTP 状态码 | 说明 |
|---|---|
| 200 | 成功 |
| 400 | 参数校验失败 |
| 401 | 未登录 / Token 过期 |
| 403 | 权限不足（非 ADMIN 角色） |
| 404 | 资源不存在 |
| 409 | 冲突（编码重复、有关联数据等） |
| 500 | 服务器内部错误 |
