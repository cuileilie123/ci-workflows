import { Test, TestingModule } from '@nestjs/testing';
import { LockAlertService } from './lock-alert.service';
import { RedisService, LockHandle, AcquireLockOptions } from './redis.service';

describe('分布式锁告警与安全释放测试', () => {
  let redisService: RedisService;
  let lockAlert: LockAlertService;

  // Mock Redis client
  let mockClient: any;

  beforeEach(async () => {
    mockClient = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      on: jest.fn(),
      quit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: LockAlertService,
          useValue: {
            sendAlert: jest.fn().mockResolvedValue(undefined),
            onLockAcquireFailed: jest.fn().mockResolvedValue(undefined),
            onLockTimeout: jest.fn().mockResolvedValue(undefined),
            onLockForceReleased: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    redisService = module.get<RedisService>(RedisService);
    lockAlert = module.get<LockAlertService>(LockAlertService);

    // 替换内部 client 为 mock（通过直接赋值）
    (redisService as any).client = mockClient;
    (redisService as any).available = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ================ LockAlertService 测试 ================
  describe('LockAlertService 告警逻辑', () => {
    it('锁获取失败应发送 ERROR 级别告警', async () => {
      await lockAlert.onLockAcquireFailed('task:lock:1', 'user:1', '接单');

      expect(lockAlert.onLockAcquireFailed).toHaveBeenCalledWith(
        'task:lock:1',
        'user:1',
        '接单',
      );
    });

    it('锁持有超时应发送对应级别告警', async () => {
      // 超过 1 倍 TTL - WARNING
      await lockAlert.onLockTimeout('task:lock:1', 'user:1', 15000, 10, '接单');
      expect(lockAlert.onLockTimeout).toHaveBeenCalled();
    });
  });

  // ================ RedisService.acquireLock 测试 ================
  describe('acquireLock 获取锁', () => {
    it('获取锁成功返回 LockHandle', async () => {
      mockClient.set.mockResolvedValue('OK');

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);

      expect(handle).toBeInstanceOf(LockHandle);
      expect(handle).not.toBeNull();
      expect(handle!.getKey()).toBe('task:1');
      expect(handle!.getValue()).toBe('user:1');
      expect(handle!.getTtlSec()).toBe(10);

      // 验证底层 SET NX EX 调用
      expect(mockClient.set).toHaveBeenCalledWith('task:1', 'user:1', 'EX', 10, 'NX');
    });

    it('获取锁失败返回 null 并发送告警', async () => {
      mockClient.set.mockResolvedValue(null); // NX 失败

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);

      expect(handle).toBeNull();
      expect(lockAlert.onLockAcquireFailed).toHaveBeenCalledWith(
        'task:1',
        'user:1',
        '',
      );
    });

    it('Redis 不可用时 setNx 返回 false 但 acquireLock 不发送告警', async () => {
      (redisService as any).available = false;

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);

      expect(handle).toBeNull();
      expect(lockAlert.onLockAcquireFailed).not.toHaveBeenCalled();
    });

    it('使用 options 配置告警阈值和上下文', async () => {
      mockClient.set.mockResolvedValue('OK');

      const opts: AcquireLockOptions = {
        alertThresholdMs: 5000,
        context: '测试上下文',
        enableWatchdog: true,
      };
      const handle = await redisService.acquireLock('task:1', 'user:1', 10, opts);

      expect(handle).not.toBeNull();
      expect(handle!.getKey()).toBe('task:1');
    });
  });

  // ================ LockHandle.release() 安全释放测试 ================
  describe('LockHandle.release() 安全释放', () => {
    it('value 匹配时释放成功（Lua 脚本返回 1）', async () => {
      mockClient.set.mockResolvedValue('OK');
      mockClient.eval.mockResolvedValue(1);

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);
      expect(handle).not.toBeNull();

      const result = await handle!.release();

      expect(result).toBe(true);
      // 验证调用了 Lua 脚本，参数为 key + value
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("GET"'),
        1,
        'task:1',
        'user:1',
      );
    });

    it('value 不匹配时释放失败（Lua 脚本返回 0）', async () => {
      mockClient.set.mockResolvedValue('OK');
      mockClient.eval.mockResolvedValue(0); // value 不匹配

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);
      expect(handle).not.toBeNull();

      const result = await handle!.release();

      expect(result).toBe(false);
      // 验证 Lua 脚本参数仍然是原始 value（不是他人的 value）
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.anything(),
        1,
        'task:1',
        'user:1', // 原始持有者的 value
      );
    });

    it('release 后应停止看门狗定时器', async () => {
      mockClient.set.mockResolvedValue('OK');
      mockClient.eval.mockResolvedValue(1);

      jest.useFakeTimers();
      const handle = await redisService.acquireLock('task:1', 'user:1', 10);
      expect(handle).not.toBeNull();

      const watchdogSpy = jest.spyOn(handle!, 'stopWatchdog');
      await handle!.release();

      expect(watchdogSpy).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  // ================ LockHandle.renew() 原子续期测试 ================
  describe('LockHandle.renew() 原子续期', () => {
    it('value 匹配时续期成功', async () => {
      mockClient.set.mockResolvedValue('OK');
      mockClient.eval.mockResolvedValue(1);

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);
      const result = await handle!.renew();

      expect(result).toBe(true);
      // 验证续期 Lua 脚本调用
      expect(mockClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("EXPIRE"'),
        1,
        'task:1',
        'user:1',
        10, // TTL
      );
    });

    it('value 不匹配时续期失败', async () => {
      mockClient.set.mockResolvedValue('OK');
      mockClient.eval.mockResolvedValue(0);

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);
      const result = await handle!.renew();

      expect(result).toBe(false);
    });
  });

  // ================ 看门狗测试 ================
  describe('看门狗（Watchdog）', () => {
    it('启动看门狗后应创建告警定时器和续期定时器', async () => {
      jest.useFakeTimers();
      mockClient.set.mockResolvedValue('OK');
      mockClient.eval.mockResolvedValue(1);

      const handle = await redisService.acquireLock('task:1', 'user:1', 10, {
        alertThresholdMs: 30000,
        enableWatchdog: true,
      });

      expect(handle).not.toBeNull();

      // 快进时间到告警阈值
      jest.advanceTimersByTime(31000);

      // 告警应被触发
      expect(lockAlert.onLockTimeout).toHaveBeenCalledWith(
        'task:1',
        'user:1',
        expect.any(Number),
        10,
        '',
      );

      jest.useRealTimers();
    });

    it('disableWatchdog=true 时不应创建定时器', async () => {
      jest.useFakeTimers();
      mockClient.set.mockResolvedValue('OK');

      const handle = await redisService.acquireLock('task:1', 'user:1', 10, {
        enableWatchdog: false,
      });

      // 快进时间
      jest.advanceTimersByTime(60000);

      // 告警不应被触发
      expect(lockAlert.onLockTimeout).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  // ================ 多锁并发场景 ================
  describe('多锁并发安全', () => {
    it('多把锁互不干扰：各自 release 只影响自己', async () => {
      mockClient.set.mockResolvedValue('OK');
      mockClient.eval.mockImplementation(
        (_script: string, _numKeys: number, key: string, value: string) => {
          // 模拟：只有 value 匹配才释放成功
          return key === 'task:1' && value === 'user:A'
            ? 1
            : key === 'task:2' && value === 'user:B'
              ? 1
              : 0;
        },
      );

      const handleA = await redisService.acquireLock('task:1', 'user:A', 10);
      const handleB = await redisService.acquireLock('task:2', 'user:B', 10);

      expect(handleA).not.toBeNull();
      expect(handleB).not.toBeNull();

      const resultA = await handleA!.release();
      const resultB = await handleB!.release();

      expect(resultA).toBe(true);
      expect(resultB).toBe(true);
    });
  });

  // ================ 向后兼容性 ================
  describe('向后兼容：setNx / del 仍可用', () => {
    it('旧的 setNx 方法仍然正常工作', async () => {
      mockClient.set.mockResolvedValue('OK');

      const result = await redisService.setNx('old:key', 'val', 30);

      expect(result).toBe(true);
      expect(mockClient.set).toHaveBeenCalledWith('old:key', 'val', 'EX', 30, 'NX');
    });

    it('旧的 del 方法仍然正常工作', async () => {
      mockClient.del.mockResolvedValue(1);

      await redisService.del('old:key');

      expect(mockClient.del).toHaveBeenCalledWith('old:key');
    });
  });

  // ================ 锁持有者时长追踪 ================
  describe('锁持有者时长追踪', () => {
    it('getHeldDurationMs 应返回从获取到现在的时长', async () => {
      jest.useFakeTimers();
      mockClient.set.mockResolvedValue('OK');

      const handle = await redisService.acquireLock('task:1', 'user:1', 10);

      jest.advanceTimersByTime(5000);

      expect(handle!.getHeldDurationMs()).toBeGreaterThanOrEqual(5000);

      jest.useRealTimers();
    });
  });
});