# 分布式锁告警功能完整回归测试指南

## 📋 测试内容

本次回归测试覆盖以下功能：

| 测试类型 | 测试文件 | 依赖 | 状态 |
|---------|---------|------|------|
| **单元测试** | `src/common/lock-alert.spec.ts` | 无（纯 Mock） | ✅ 已通过 |
| **集成测试** | `src/common/lock-alert.integration.spec.ts` | 需要真实 Redis | ⏳ 待 Docker 就绪 |
| **死锁测试** | `src/modules/wallet/wallet.deadlock.spec.ts` | 无（纯 Mock） | ✅ 已通过 |
| **死锁测试** | `src/modules/payment/payment.deadlock.spec.ts` | 无（纯 Mock） | ✅ 已通过 |

## 🚀 执行步骤

### 第一步：启动 Docker 容器

```powershell
# 进入项目根目录
cd d:\neighborhood-help

# 启动 MySQL + Redis（后台运行）
docker compose up -d mysql redis

# 等待容器健康检查通过（约 15 秒）
Start-Sleep -Seconds 15

# 验证容器状态
docker compose ps
```

### 第二步：安装依赖并生成 Prisma 客户端

```powershell
cd d:\neighborhood-help\bff

# 安装依赖
pnpm install --frozen-lockfile

# 生成 Prisma 客户端
$env:DATABASE_URL="mysql://root:root123@localhost:3306/neighborhood_help"
pnpm prisma generate
```

### 第三步：运行完整测试套件

```powershell
# 运行单元测试（锁告警 + 死锁回归 + 全部单元测试）
pnpm test -- --passWithNoTests --forceExit

# 运行集成测试（锁告警 + 真实 Redis）
pnpm test:e2e -- --testPathPatterns="lock-alert"
```

### 第四步：验证关键输出

**单元测试预期输出**：
```
PASS src/common/lock-alert.spec.ts
  分布式锁告警与安全释放测试
    LockAlertService 告警逻辑
      √ 锁获取失败应发送 ERROR 级别告警
      √ 锁持有超时应发送对应级别告警
    acquireLock 获取锁
      √ 获取锁成功返回 LockHandle
      ...
Tests:       17 passed, 17 total

PASS src/modules/wallet/wallet.deadlock.spec.ts
...
PASS src/modules/payment/payment.deadlock.spec.ts
...
Tests:       61 passed, 61 total
```

**集成测试预期输出**（需要 Redis）：
```
PASS src/common/lock-alert.integration.spec.ts
  分布式锁告警集成测试（真实 Redis）
    acquireLock 真实 Redis 测试
      ✅ 获取锁成功并返回 LockHandle
      ✅ 同一把锁第二次获取应失败
      ✅ 锁释放后他人可获取
    LockHandle 安全释放测试
      ✅ value 匹配才能释放（Lua 脚本原子性验证）
    ...
```

## 🔍 关键验证点

### 分布式锁告警功能

| 验证点 | 测试用例 | 预期结果 |
|--------|---------|---------|
| 锁获取失败告警 | `onLockAcquireFailed` | 发送 ERROR 级别日志 |
| 锁持有超时告警 | 超过 `alertThresholdMs` | 分级告警（WARNING→ERROR→CRITICAL） |
| 锁被覆盖告警 | `onLockForceReleased` | 发送 CRITICAL 级别告警 |
| 看门狗启动 | `enableWatchdog: true` | 创建告警定时器 + 续期定时器 |
| 看门狗禁用 | `enableWatchdog: false` | 不创建任何定时器 |

### 安全释放（防止误删）

| 验证点 | 测试用例 | 预期结果 |
|--------|---------|---------|
| value 匹配释放 | `release()` 原始持有者 | Lua 脚本返回 1，删除 key |
| value 不匹配释放 | `release()` 非持有者 | Lua 脚本返回 0，key 不变 |
| 原子续期 | `renew()` 原始持有者 | Lua 脚本延长 TTL |
| 续期失败 | `renew()` 非持有者 | Lua 脚本返回 0，TTL 不变 |

### 向后兼容性

| 验证点 | 测试用例 | 预期结果 |
|--------|---------|---------|
| `setNx()` 旧 API | 直接调用 | 正常返回 true/false |
| `del()` 旧 API | 直接调用 | 正常删除 key |
| `get()` 旧 API | 直接调用 | 正常返回 value/null |

## 📊 测试覆盖率统计

### 单元测试（已完成）

| 模块 | 测试文件 | 用例数 | 通过率 |
|------|---------|--------|--------|
| LockAlertService | lock-alert.spec.ts | 17 | 100% |
| WalletService | wallet.deadlock.spec.ts | 10 | 100% |
| PaymentService | payment.deadlock.spec.ts | 9 | 100% |
| WalletService | wallet.service.spec.ts | 25 | 100% |
| **合计** | 4 个文件 | **61** | **100%** |

### 集成测试（待 Docker 就绪）

| 模块 | 测试文件 | 用例数 | 依赖 |
|------|---------|--------|------|
| RedisService + LockAlertService | lock-alert.integration.spec.ts | 10+ | 真实 Redis |

## ⚠️ 故障排查

### Redis 连接失败

```powershell
# 检查 Redis 容器状态
docker compose ps redis

# 查看 Redis 日志
docker compose logs redis

# 手动测试 Redis 连接
docker compose exec redis redis-cli ping
# 预期输出：PONG
```

### 测试依赖 Prisma 未生成

```powershell
cd bff
pnpm prisma generate
```

### 测试定时器泄漏告警

```
A worker process has failed to exit gracefully...
```

这是因为单元测试中使用了 `jest.useFakeTimers()` 但部分定时器未清理。可忽略，不影响测试结果。

## 📝 环境变量说明

```env
# Redis 连接
REDIS_HOST=localhost
REDIS_PORT=6379

# 锁告警配置
LOCK_ALERT_ENABLED=true
# 可选：钉钉/飞书 Webhook
LOCK_ALERT_WEBHOOK=https://oapi.dingtalk.com/robot/send?access_token=xxx
```