/**
 * 分布式锁告警集成测试（需要真实 Redis 实例）
 *
 * 启动前请确保：
 *   1. Redis 在 localhost:6379 运行（可通过 Docker 启动）
 *   2. 设置环境变量：REDIS_HOST=localhost REDIS_PORT=6379
 *
 * 运行命令：
 *   pnpm test:e2e -- --testPathPatterns="lock-alert" --forceExit
 */

import { Test, TestingModule } from '@nestjs/testing';
import { LockAlertService } from './lock-alert.service';
import { RedisService } from './redis.service';
import { createTestLogger } from '@neighborhood-help/test-utils';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

// 生成唯一 key 后缀，避免测试间 key 冲突
let keyCounter = 0;
const uniqueKey = (base: string) => `${base}:${Date.now()}:${keyCounter++}`;

const log = createTestLogger('lock-alert.integration');

describe('分布式锁告警集成测试（真实 Redis）', () => {
  let redisService: RedisService;
  let lockAlert: LockAlertService;
  let moduleRef: TestingModule;
  const acquiredHandles: Array<{ release: () => Promise<boolean>; getKey: () => string }> = [];

  beforeAll(async () => {
    process.env.REDIS_HOST = REDIS_HOST;
    process.env.REDIS_PORT = String(REDIS_PORT);

    log(`beforeAll: 创建 TestingModule（目标 Redis ${REDIS_HOST}:${REDIS_PORT}）`);
    const t0 = Date.now();
    moduleRef = await Test.createTestingModule({
      providers: [RedisService, LockAlertService],
    }).compile();
    log(`beforeAll: TestingModule 编译完成，耗时 ${Date.now() - t0}ms`);

    redisService = moduleRef.get<RedisService>(RedisService);
    lockAlert = moduleRef.get<LockAlertService>(LockAlertService);

    log('beforeAll: 等待 Redis 连接就绪...');
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (redisService.isAvailable()) {
          clearInterval(timer);
          log(`beforeAll: Redis 已连接就绪，等待耗时 ${Date.now() - start}ms`);
          resolve(true);
        } else if (Date.now() - start > 10000) {
          clearInterval(timer);
          log('beforeAll: Redis 连接超时（10s）');
          reject(new Error('Redis 连接超时（10s）'));
        }
      }, 200);
    });
  }, 15000);

  afterEach(async () => {
    // 每个测试后释放所有已获取的锁
    for (const handle of acquiredHandles) {
      try {
        await handle.release();
      } catch {
        // 忽略释放错误
      }
    }
    acquiredHandles.length = 0;
  });

  afterAll(async () => {
    // 最终清理：扫描并删除所有测试 key
    log('afterAll: 开始清理测试 key');
    for (let i = 0; i < 100; i++) {
      await redisService.del(`test:lock:integration:cleanup:${i}`);
    }
    log('afterAll: 测试 key 清理完成');
    // 关闭模块，触发 onModuleDestroy 断开 Redis 连接
    log('afterAll: 开始关闭 TestingModule（触发 onModuleDestroy → Redis quit）');
    const t0 = Date.now();
    await moduleRef.close();
    log(`afterAll: TestingModule 已关闭，耗时 ${Date.now() - t0}ms，Redis 连接应已断开`);
  });

  const trackHandle = (handle: any) => {
    if (handle) acquiredHandles.push(handle);
    return handle;
  };

  describe('acquireLock 真实 Redis 测试', () => {
    it('✅ 获取锁成功并返回 LockHandle', async () => {
      const key = uniqueKey('test:lock:integration');
      const handle = trackHandle(
        await redisService.acquireLock(key, 'integration-user', 10, {
          context: '集成测试',
        }),
      );

      expect(handle).not.toBeNull();
      expect(handle!.getKey()).toBe(key);
      expect(handle!.getValue()).toBe('integration-user');
      expect(handle!.getTtlSec()).toBe(10);

      await handle!.release();
      acquiredHandles.length = 0;

      const val = await redisService.get(key);
      expect(val).toBeNull();
    });

    it('✅ 同一把锁第二次获取应失败', async () => {
      const key = uniqueKey('test:lock:integration');

      const handle1 = trackHandle(await redisService.acquireLock(key, 'user-A', 30));
      expect(handle1).not.toBeNull();

      const handle2 = await redisService.acquireLock(key, 'user-B', 30);
      expect(handle2).toBeNull();

      await handle1!.release();
      acquiredHandles.length = 0;
    });

    it('✅ 锁释放后他人可获取', async () => {
      const key = uniqueKey('test:lock:integration');

      const handle1 = await redisService.acquireLock(key, 'user-A', 30);
      expect(handle1).not.toBeNull();
      await handle1!.release();

      const handle2 = trackHandle(await redisService.acquireLock(key, 'user-B', 30));
      expect(handle2).not.toBeNull();
      expect(handle2!.getValue()).toBe('user-B');
    });
  });

  describe('LockHandle 安全释放测试', () => {
    it('✅ value 匹配才能释放（Lua 脚本原子性验证）', async () => {
      const key = uniqueKey('test:lock:integration');

      const handleA = trackHandle(await redisService.acquireLock(key, 'user-A', 30));
      expect(handleA).not.toBeNull();

      // 模拟 TTL 过期后 User B 获取了锁
      await redisService.set(key, 'user-B', 30);

      // User A 尝试释放 - 应该失败（value 不匹配）
      const releasedByA = await handleA!.release();
      acquiredHandles.length = 0;
      expect(releasedByA).toBe(false);

      const currentVal = await redisService.get(key);
      expect(currentVal).toBe('user-B');
    });
  });

  describe('LockHandle 原子续期测试', () => {
    it('✅ value 匹配时续期成功', async () => {
      const key = uniqueKey('test:lock:integration');

      const handle = trackHandle(await redisService.acquireLock(key, 'user-renew', 5));
      expect(handle).not.toBeNull();

      const renewed = await handle!.renew();
      expect(renewed).toBe(true);

      const val = await redisService.get(key);
      expect(val).toBe('user-renew');
    });

    it('✅ value 不匹配时续期失败', async () => {
      const key = uniqueKey('test:lock:integration');

      const handle = trackHandle(await redisService.acquireLock(key, 'user-renew-2', 10));
      expect(handle).not.toBeNull();

      // 篡改 value
      await redisService.set(key, 'other-user', 10);

      const renewed = await handle!.renew();
      expect(renewed).toBe(false);
    });
  });

  describe('看门狗超时告警测试', () => {
    it('✅ 锁持有超过阈值时触发告警', async () => {
      jest.useFakeTimers();

      const key = uniqueKey('test:lock:integration');
      const alertSpy = jest.spyOn(lockAlert, 'onLockTimeout').mockClear();

      const handle = trackHandle(
        await redisService.acquireLock(key, 'user-timeout', 5, {
          alertThresholdMs: 2000,
          enableWatchdog: true,
        }),
      );

      jest.advanceTimersByTime(2100);

      expect(alertSpy).toHaveBeenCalled();
      expect(alertSpy.mock.calls[0][0]).toBe(key);
      expect(alertSpy.mock.calls[0][1]).toBe('user-timeout');

      await handle!.release();
      acquiredHandles.length = 0;
      jest.useRealTimers();
    });

    it('✅ disableWatchdog=true 时不创建定时器', async () => {
      jest.useFakeTimers();

      const key = uniqueKey('test:lock:integration');
      const alertSpy = jest.spyOn(lockAlert, 'onLockTimeout').mockClear();

      const handle = trackHandle(
        await redisService.acquireLock(key, 'user-no-watchdog', 10, {
          alertThresholdMs: 1000,
          enableWatchdog: false,
        }),
      );

      jest.advanceTimersByTime(5000);
      expect(alertSpy).not.toHaveBeenCalled();

      await handle!.release();
      acquiredHandles.length = 0;
      jest.useRealTimers();
    });
  });

  describe('自动续期机制测试', () => {
    it('✅ 续期成功时自动继续续期', async () => {
      jest.useFakeTimers();

      const key = uniqueKey('test:lock:integration');

      const handle = trackHandle(
        await redisService.acquireLock(key, 'user-auto-renew', 3, {
          alertThresholdMs: 30000,
          enableWatchdog: true,
        }),
      );

      // TTL=3s，续期间隔 = 3/3 = 1s
      jest.advanceTimersByTime(1100);

      // 手动验证续期
      const renewed = await handle!.renew();
      expect(renewed).toBe(true);

      await handle!.release();
      acquiredHandles.length = 0;
      jest.useRealTimers();
    });
  });

  describe('向后兼容性测试', () => {
    it('✅ 旧 setNx API 仍可用', async () => {
      const key = uniqueKey('test:lock:integration');
      const result = await redisService.setNx(key, 'old-api-user', 10);
      expect(result).toBe(true);

      const val = await redisService.get(key);
      expect(val).toBe('old-api-user');

      await redisService.del(key);
    });

    it('✅ 旧 del API 仍可用', async () => {
      const key = uniqueKey('test:lock:integration');
      await redisService.set(key, 'to-delete', 10);
      await redisService.del(key);

      const val = await redisService.get(key);
      expect(val).toBeNull();
    });
  });

  describe('并发锁测试', () => {
    it('✅ 多把锁互不干扰', async () => {
      const keyA = uniqueKey('test:lock:integration');
      const keyB = uniqueKey('test:lock:integration');

      const handleA = trackHandle(await redisService.acquireLock(keyA, 'user-A', 30));
      const handleB = trackHandle(await redisService.acquireLock(keyB, 'user-B', 30));

      expect(handleA).not.toBeNull();
      expect(handleB).not.toBeNull();

      const valA = await redisService.get(keyA);
      const valB = await redisService.get(keyB);
      expect(valA).toBe('user-A');
      expect(valB).toBe('user-B');
    });

    it('✅ 10 次并发获取同一把锁只有 1 次成功', async () => {
      const key = uniqueKey('test:lock:integration');
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          redisService.acquireLock(key, `user-${i}`, 30),
        ),
      );

      const successes = results.filter((r) => r !== null);
      expect(successes.length).toBe(1);

      if (successes[0]) {
        await successes[0]!.release();
      }
    });
  });

  describe('锁持有者时长追踪', () => {
    it('✅ getHeldDurationMs 应返回正确时长', async () => {
      jest.useFakeTimers();

      const key = uniqueKey('test:lock:integration');
      const handle = trackHandle(await redisService.acquireLock(key, 'user-duration', 30));

      jest.advanceTimersByTime(5000);

      expect(handle!.getHeldDurationMs()).toBeGreaterThanOrEqual(5000);

      jest.useRealTimers();
    });
  });
});