# Project Memory — 社区邻里有偿互助平台

> 此文件由 Trae 自动加载，记录架构决策、技术栈约定、禁止事项。
> 修改此文件 = 修改 AI 的"长期记忆"。

---

## 1. 技术栈（Tech Stack）

### 前端（Mini Program）
- **框架**: UniApp 3.x + TypeScript
- **状态管理**: Pinia
- **UI**: 自定义组件 + Tailwind-WXSS
- **HTTP**: 封装 `request.ts`，拦截器注入 `Authorization: Bearer {token}`
- **地图**: 腾讯地图微信小程序 SDK
- **包管理**: pnpm

### 中端（BFF / Middle Platform）
- **框架**: NestJS 10.x + TypeScript
- **ORM**: Prisma 5.x
- **缓存**: Redis 7.x
- **实时通信**: WebSocket (Socket.IO)
- **鉴权**: JWT (HS256, 过期 2h) + Refresh Token (7d)

### 后端（Microservices）
- **主语言**: Go 1.22 (Gin) + Java 21 (Spring Boot 3.x)
- **数据库**: MySQL 8.0（业务数据）+ MongoDB 7.x（IM 消息）+ Elasticsearch 8.x（搜索）
- **消息队列**: RabbitMQ 3.13
- **文件存储**: 腾讯云 COS
- **容器**: Docker + Kubernetes (Aliyun ACK)

---

## 2. 架构决策（ADR）

### ADR-001: 为什么分前端/BFF/后端三层？
- 小程序体积限制（< 2MB），复杂逻辑下沉
- BFF 层做鉴权 + 聚合，后端只管纯业务逻辑
- 后端微服务化，方便独立扩缩容

### ADR-002: 支付走微信支付 V3
- 小程序内必须走微信支付，不能用其他渠道
- V3 接口统一 RSA 签名，比 V2 的 MD5 安全
- 使用 `wechatpay-go` SDK

### ADR-003: 地理位置用 GeoHash
- MySQL 内置 `ST_Distance_Sphere` 性能不够
- GeoHash 精度 7 位 ≈ 150m，满足"附近 3km"需求
- Redis GEO 命令做实时位置缓存

### ADR-004: 订单状态机
```
PENDING → ACCEPTED → IN_PROGRESS → COMPLETED → SETTLED
                    ↘ CANCELLED ↗
```
- 使用状态模式（State Pattern），禁止 if-else 堆砌
- 状态变更必须写事件日志

---

## 3. 数据库核心表结构

```sql
-- users
id BIGINT PK | openid VARCHAR(64) UNIQUE | phone VARCHAR(20) | credit_score INT DEFAULT 100 | role ENUM('USER','HELPER','ADMIN') | created_at DATETIME

-- tasks
id BIGINT PK | publisher_id BIGINT FK | title VARCHAR(100) | description TEXT | price DECIMAL(10,2) | lng DECIMAL(10,7) | lat DECIMAL(10,7) | geohash VARCHAR(12) | status ENUM('OPEN','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED') | expire_at DATETIME | created_at DATETIME

-- orders
id BIGINT PK | task_id BIGINT FK UNIQUE | helper_id BIGINT FK | total_amount DECIMAL(10,2) | platform_fee DECIMAL(10,2) | status ENUM('PENDING','PAID','IN_PROGRESS','COMPLETED','CANCELLED','REFUNDED') | created_at DATETIME

-- wallets
id BIGINT PK | user_id BIGINT FK UNIQUE | balance DECIMAL(10,2) DEFAULT 0 | frozen DECIMAL(10,2) DEFAULT 0

-- transactions (复式记账)
id BIGINT PK | wallet_id BIGINT FK | order_id BIGINT FK | type ENUM('INCOME','EXPENSE','FREEZE','UNFREEZE') | amount DECIMAL(10,2) | balance_after DECIMAL(10,2) | description VARCHAR(255) | created_at DATETIME

-- reviews
id BIGINT PK | order_id BIGINT FK UNIQUE | reviewer_id BIGINT FK | reviewee_id BIGINT FK | rating TINYINT(1-5) | tags JSON | comment VARCHAR(500) | created_at DATETIME
```

---

## 4. 禁止事项（Hard Rules）

1. ❌ 禁止前端直接调后端微服务（必须经 BFF）
2. ❌ 禁止明文存储手机号（AES-256 加密）
3. ❌ 禁止 SQL 拼接（必须用 ORM 或 PreparedStatement）
4. ❌ 禁止跳过支付直接改订单状态
5. ❌ 禁止删除数据（软删除 `deleted_at`）
6. ❌ 禁止在生产环境用 `console.log` 打印用户隐私
7. ❌ 禁止微信支付密钥提交到 Git
8. ❌ 禁止 API 无版本号（必须 `/api/v1/...`）
9. ❌ 禁止前端存储 JWT 到 localStorage（小程序用 `wx.setStorage` 加密存储）
10. ❌ 禁止单文件超过 300 行

---

## 5. 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件 | kebab-case | `task-service.ts` |
| 类 | PascalCase | `TaskService` |
| 函数 | camelCase | `getTaskById()` |
| 常量 | UPPER_SNAKE | `MAX_TASK_RADIUS_KM` |
| 数据库表 | snake_case 复数 | `task_orders` |
| Git 分支 | feature/xxx | `feature/wx-login` |
| API 路径 | 复数资源 | `/api/v1/tasks` |

---

## 6. 已知坑 & 解决方案

| 坑 | 解决方案 |
|----|---------|
| 微信 `code2Session` 偶发返回 40163 | 重试 3 次，指数退避 |
| 小程序 `wx.uploadFile` 不支持 PUT | 后端提供 POST 预签名 URL |
| 腾讯地图 `chooseLocation` iOS 返回精度差 | 服务端二次纠偏 |
| 微信支付 V3 签名验证失败 | 检查 `serial_no` 是否匹配证书 |
| Prisma `BigInt` JSON 序列化丢失精度 | 自定义 `BigIntSerializer` |
| Redis GeoHash 精度不够 | 叠加 `ST_Distance_Sphere` 精算 |

---

## 7. 环境变量清单

```
# 微信小程序
WX_APPID=
WX_SECRET=
WX_MCH_ID=
WX_API_V3_KEY=

# 数据库
MYSQL_HOST=
MYSQL_PORT=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=

# Redis
REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=

# JWT
JWT_SECRET=
JWT_REFRESH_SECRET=

# 腾讯云 COS
COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=

# 腾讯地图
MAP_KEY=
```
