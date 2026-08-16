# 测试资源泄漏修复报告

> 生成时间：2026-08-07
> 测试环境：Windows / Node.js v24.18.1 / pnpm v11.18.0
> 测试框架：Jest + ts-jest + NestJS TestingModule
> 修复范围：BFF 测试套件中 TestingModule 与 Redis 连接的资源泄漏问题

---

## 一、问题背景

在运行 Jest 测试套件时，控制台持续输出以下警告：

```
Jest did not exit one second after the test run has completed.
This usually means that there are asynchronous operations that weren't stopped in your tests.
```

该警告表明测试结束后仍有未释放的异步资源（socket 连接、定时器、DI 容器等）阻止 Jest 进程退出。虽然测试用例本身全部通过，但长期运行会：
- 导致 CI 流水线卡死或超时
- 掩盖真实的资源管理缺陷
- 增加 IDE 测试运行的等待时间

---

## 二、根因分析

经过 `--detectOpenHandles` 排查与代码审查，定位到三类根因：

### 2.1 RedisService 构造函数创建真实连接未被断开

[redis.service.ts](file:///d:/neighborhood-help/bff/src/common/redis.service.ts) 的构造函数会在实例化时调用 `new Redis(...)` 建立真实 TCP 连接：

```typescript
constructor(private readonly lockAlert: LockAlertService) {
  this.client = new Redis({ host, port, ... });
}
```

在 [lock-alert.spec.ts](file:///d:/neighborhood-help/bff/src/common/lock-alert.spec.ts) 中，虽然测试用 mock 替换了 `redisService.client`，但**构造函数创建的真实 client 仍持有 socket**，且从未调用 `disconnect()` 或 `quit()`。

### 2.2 TestingModule 未调用 close()

NestJS 的 `Test.createTestingModule(...).compile()` 返回的 `TestingModule` 实例持有完整的 DI 容器。未调用 `moduleRef.close()` 会导致：
- `onModuleDestroy` 钩子不被触发
- RedisService 内部的 `client.quit()` 不被调用
- DI 容器内的所有 provider 实例常驻内存

涉及文件普遍存在 `const module: TestingModule = ...` 的局部变量写法，导致模块引用在函数返回后丢失，无法清理。

### 2.3 死锁测试中每个用例创建新模块从不关闭

[wallet.deadlock.spec.ts](file:///d:/neighborhood-help/bff/src/modules/wallet/wallet.deadlock.spec.ts) 和 [payment.deadlock.spec.ts](file:///d:/neighborhood-help/bff/src/modules/payment/payment.deadlock.spec.ts) 的 `compileService()` 在每个 `it` 内被调用，单套件会创建 9~10 个 TestingModule 实例，全部未关闭。

---

## 三、修复方案与变更清单

### 3.1 新建通用测试辅助工具

**文件**：[test-utils.ts](file:///d:/neighborhood-help/bff/src/common/test-utils.ts)

提供 `createTestLogger(tag)` 工厂函数，统一生成带 ISO 时间戳的日志输出，便于排查资源释放时序问题：

```typescript
export function createTestLogger(tag: string): (msg: string) => void {
  return (msg: string) =>
    console.log(`[${tag}] ${new Date().toISOString()} ${msg}`);
}
```

### 3.2 修复文件清单

| # | 文件 | 问题类型 | 关键变更 |
|---|------|---------|---------|
| 1 | [lock-alert.spec.ts](file:///d:/neighborhood-help/bff/src/common/lock-alert.spec.ts) | 真实 Redis 未断开 + Module 未关闭 | beforeEach 中先 `realClient.disconnect()` 再替换为 mock；afterEach 中 `moduleRef.close()`；mock 的 `quit` 添加 `mockResolvedValue` |
| 2 | [lock-alert.integration.spec.ts](file:///d:/neighborhood-help/bff/src/common/lock-alert.integration.spec.ts) | Module 未关闭 | 提升为 `moduleRef` 实例变量；afterAll 中 `moduleRef.close()` |
| 3 | [rate-limit.integration.spec.ts](file:///d:/neighborhood-help/bff/src/common/rate-limit.integration.spec.ts) | Module 未关闭 | 同上 |
| 4 | [wallet.service.spec.ts](file:///d:/neighborhood-help/bff/src/modules/wallet/wallet.service.spec.ts) | Module 未关闭 | 提升为 `moduleRef` 实例变量；afterEach 中 `moduleRef.close()` |
| 5 | [wallet.deadlock.spec.ts](file:///d:/neighborhood-help/bff/src/modules/wallet/wallet.deadlock.spec.ts) | 每用例创建新 Module 从不关闭 | `compileService` 内先关闭上一个 Module；新增 afterEach 关闭当前 Module |
| 6 | [payment.deadlock.spec.ts](file:///d:/neighborhood-help/bff/src/modules/payment/payment.deadlock.spec.ts) | 同上 | 同上 |

### 3.3 关键修复模式

**模式一：单元测试（mock Redis）**

```typescript
beforeEach(async () => {
  moduleRef = await Test.createTestingModule({...}).compile();
  redisService = moduleRef.get(RedisService);

  // 关键：断开构造函数创建的真实 Redis 连接
  const realClient = (redisService as any).client;
  if (realClient?.disconnect) realClient.disconnect();

  // 替换为 mock
  (redisService as any).client = mockClient;
});

afterEach(async () => {
  // 先关闭模块（触发 onModuleDestroy），再清理 mocks
  if (moduleRef) await moduleRef.close();
  jest.clearAllMocks();
});
```

**模式二：集成测试（真实 Redis）**

```typescript
beforeAll(async () => {
  moduleRef = await Test.createTestingModule({...}).compile();
  // 等待 Redis 连接就绪...
});

afterAll(async () => {
  await redisService.del('test:cleanup:key');
  await moduleRef.close(); // 触发 onModuleDestroy → client.quit()
});
```

**模式三：每用例重编译模块**

```typescript
let moduleRef: TestingModule | null = null;

const compileService = async (mock) => {
  if (moduleRef) await moduleRef.close(); // 先关闭上一个
  moduleRef = await Test.createTestingModule({...}).compile();
  return moduleRef.get(Service);
};

afterEach(async () => {
  if (moduleRef) {
    await moduleRef.close();
    moduleRef = null;
  }
});
```

---

## 四、验证结果

### 4.1 测试通过情况

| 测试类型 | 套件数 | 用例数 | 通过率 | Jest 退出警告 | 耗时 |
|---------|-------|-------|-------|--------------|------|
| 单元测试 | 5 | 89 | 100% | 无 | 5.548s |
| 集成测试 | 3 | 35 | 100% | 无 | 8.019s |
| **合计** | **8** | **124** | **100%** | **无** | — |

### 4.2 诊断日志样例

修复后的日志显示资源释放时序完整闭环：

**单元测试**（每个用例的编译/关闭闭环）：
```
[wallet.deadlock] 2026-08-07T15:59:39.502Z compileService: 开始编译新 TestingModule
[wallet.deadlock] 2026-08-07T15:59:39.503Z compileService: TestingModule 编译完成，耗时 1ms
[wallet.deadlock] 2026-08-07T15:59:39.504Z afterEach: 关闭 TestingModule
[wallet.deadlock] 2026-08-07T15:59:39.504Z afterEach: TestingModule 已关闭，耗时 0ms
```

**集成测试**（Redis 连接建立/断开闭环）：
```
[lock-alert.integration] 2026-08-07T16:00:46.365Z beforeAll: 创建 TestingModule（目标 Redis localhost:6379）
[lock-alert.integration] 2026-08-07T16:00:46.370Z beforeAll: TestingModule 编译完成，耗时 2ms
[lock-alert.integration] 2026-08-07T16:00:46.582Z beforeAll: Redis 已连接就绪，等待耗时 211ms
[lock-alert.integration] 2026-08-07T16:00:46.710Z afterAll: 开始关闭 TestingModule（触发 onModuleDestroy → Redis quit）
[lock-alert.integration] 2026-08-07T16:00:46.712Z afterAll: TestingModule 已关闭，耗时 2ms，Redis 连接应已断开
```

### 4.3 退出状态验证

两轮测试均以 `exit code 0` 干净退出，输出末尾为 `Ran all test suites.`，无需 `--forceExit` 参数。

---

## 五、后续规范建议

为避免同类问题再次出现，建议在项目测试规范中明确以下原则：

1. **TestingModule 必须关闭**：凡是通过 `Test.createTestingModule` 创建的模块，必须在 `afterEach` 或 `afterAll` 中调用 `moduleRef.close()`。
2. **构造函数有副作用的 Service 需特殊处理**：如 `RedisService` 在构造时建立连接，测试中需在替换 mock 前显式断开真实连接。
3. **每用例重编译模式需配套清理**：若 `compileService` 在每个 `it` 内调用，必须确保上一个模块被关闭（建议在 `compileService` 开头和 `afterEach` 中都做清理）。
4. **新增测试统一使用 `createTestLogger`**：便于在出现泄漏时快速定位时序问题，日志来源统一指向 `common/test-utils.ts`。
5. **CI 中禁用 `--forceExit`**：强制 Jest 自然退出，任何资源泄漏都会被立即发现并阻断流水线。
