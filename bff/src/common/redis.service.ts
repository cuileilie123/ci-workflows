import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { LockAlertService } from './lock-alert.service';

/**
 * 锁配置选项
 */
export interface AcquireLockOptions {
  /** 锁被持有时长告警阈值（毫秒），超过此值触发告警，默认 30_000ms */
  alertThresholdMs?: number;
  /** 是否启动看门狗自动告警，默认 true */
  enableWatchdog?: boolean;
  /** 业务上下文描述，用于告警日志 */
  context?: string;
}

/**
 * 可重入的分布式锁句柄
 *
 * 用法：
 *   const handle = await redis.acquireLock('task:lock:1', 'user-123', 10);
 *   if (!handle) throw new ConflictException('获取锁失败');
 *   try {
 *     // 业务逻辑（锁被看门狗监控，超时自动告警）
 *   } finally {
 *     await handle.release(); // 原子释放（校验 value 防止误删他人锁）
 *   }
 */
export class LockHandle {
  private readonly logger = new Logger('LOCK');
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private renewedTimers: ReturnType<typeof setTimeout>[] = [];
  private readonly acquiredAt: number;

  constructor(
    private readonly redis: Redis | null,
    private readonly lockAlert: LockAlertService,
    private readonly key: string,
    private readonly value: string,
    private readonly ttlSec: number,
    private readonly alertThresholdMs: number,
    private readonly context: string,
  ) {
    this.acquiredAt = Date.now();
  }

  /**
   * 启动看门狗：当锁持有时长超过告警阈值时发送告警。
   * 同时每 TTL/3 自动续期，防止业务执行中锁过期。
   */
  startWatchdog(): this {
    this.stopWatchdog();

    // 告警计时器：超过 alertThresholdMs 触发告警
    this.watchdogTimer = setTimeout(async () => {
      const heldMs = Date.now() - this.acquiredAt;
      await this.lockAlert.onLockTimeout(
        this.key,
        this.value,
        heldMs,
        this.ttlSec,
        this.context,
      );
    }, this.alertThresholdMs);

    // 自动续期：每 TTL/3 续期一次，防止长任务执行中锁过期
    const renewIntervalMs = (this.ttlSec * 1000) / 3;
    const scheduleRenew = () => {
      const timer = setTimeout(async () => {
        try {
          await this.renew();
          scheduleRenew(); // 继续下一次续期
        } catch {
          // 续期失败（可能锁已被他人获取），不再续期
          this.logger.warn(`🔄 锁续期失败: key=${this.key}，停止续期`);
        }
      }, renewIntervalMs);
      this.renewedTimers.push(timer);
    };
    scheduleRenew();

    return this;
  }

  /**
   * 停止看门狗
   */
  stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    for (const t of this.renewedTimers) {
      clearTimeout(t);
    }
    this.renewedTimers = [];
  }

  /**
   * 原子续期：仅当锁 value 匹配时才延长 TTL
   */
  async renew(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const res = await this.redis.eval(
        RENEW_SCRIPT,
        1,
        this.key,
        this.value,
        this.ttlSec,
      );
      return res === 1;
    } catch {
      return false;
    }
  }

  /**
   * 原子释放锁：仅当锁 value 匹配时才删除（使用 Lua 脚本防止误删）
   */
  async release(): Promise<boolean> {
    this.stopWatchdog();
    if (!this.redis) return true; // Redis 不可用时跳过
    try {
      const res = await this.redis.eval(
        UNLOCK_SCRIPT,
        1,
        this.key,
        this.value,
      );
      return res === 1;
    } catch {
      return false;
    }
  }

  /** 获取锁已持有时长（毫秒） */
  getHeldDurationMs(): number {
    return Date.now() - this.acquiredAt;
  }

  getKey(): string {
    return this.key;
  }

  getValue(): string {
    return this.value;
  }

  getTtlSec(): number {
    return this.ttlSec;
  }
}

/**
 * 解锁 Lua 脚本：仅当 value 匹配时才删除 key
 * 防止：A 的锁 TTL 过期后，B 获取了锁，此时 A 执行 del 误删 B 的锁
 */
const UNLOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/**
 * 续期 Lua 脚本：仅当 value 匹配时才延长 TTL
 */
const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

/**
 * 固定窗口限流 Lua 脚本：
 * INCR 计数，首次请求时设置窗口 TTL，后续请求仅递增。
 * 整个操作原子执行，避免 INCR 与 EXPIRE 之间的竞态。
 */
const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

/** 限流结果 */
export interface RateLimitResult {
  /** 是否放行 */
  allowed: boolean;
  /** 窗口内剩余可用次数 */
  remaining: number;
  /** 当前窗口已使用次数 */
  count: number;
}

/**
 * Redis 服务（全局共享）。
 *
 * 连接失败时优雅降级：
 * - 缓存读 (get) 返回 null → 调用方回退到数据库
 * - 缓存写 (set) 静默跳过
 * - 分布式锁 (setNx) 返回 false → 调用方应回退到数据库层条件更新
 *
 * 这样本地开发未启 Redis 时 BFF 仍可正常工作。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private available = false;

  constructor(private readonly lockAlert: LockAlertService) {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT) || 6379;
    const password = process.env.REDIS_PASSWORD || undefined;
    const url = process.env.REDIS_URL;

    try {
      this.client = url
        ? new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
        : new Redis({ host, port, password, maxRetriesPerRequest: 1, enableOfflineQueue: false });

      this.client.on('error', (err) => {
        if (this.available) {
          this.logger.warn(`Redis 连接异常，降级为无缓存模式: ${err.message}`);
          this.available = false;
        }
      });
      this.client.on('ready', () => {
        this.available = true;
        this.logger.log('Redis 已连接，缓存/分布式锁可用');
      });
    } catch (err) {
      this.logger.warn(`Redis 初始化失败，降级运行: ${(err as Error).message}`);
      this.client = null;
    }
  }

  isAvailable(): boolean {
    return this.available && this.client !== null;
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable() || !this.client) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  /** 设置带 TTL（秒）的缓存 */
  async set(key: string, value: string, ttlSec: number): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    try {
      await this.client.set(key, value, 'EX', ttlSec);
    } catch {
      // 静默
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    try {
      await this.client.del(key);
    } catch {
      // 静默
    }
  }

  /** List 左端插入（离线消息入队） */
  async lpush(key: string, value: string): Promise<void> {
    if (!this.isAvailable() || !this.client) return;
    try {
      await this.client.lpush(key, value);
    } catch {
      // 静默
    }
  }

  /** List 范围查询（离线消息拉取） */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.isAvailable() || !this.client) return [];
    try {
      return await this.client.lrange(key, start, stop);
    } catch {
      return [];
    }
  }

  /**
   * 分布式锁：SET key value NX EX ttl
   * @returns true=获取锁成功
   */
  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    if (!this.isAvailable() || !this.client) return false;
    try {
      const res = await this.client.set(key, value, 'EX', ttlSec, 'NX');
      return res === 'OK';
    } catch {
      return false;
    }
  }

  /**
   * 固定窗口限流（原子操作）。
   * Redis 不可用时降级放行（allowed=true），与缓存降级策略一致。
   *
   * @param key 限流 key（建议带用户ID，如 `ratelimit:withdraw:123`）
   * @param limit 窗口内允许的最大请求次数
   * @param windowSec 窗口时长（秒）
   */
  async rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    if (!this.isAvailable() || !this.client) {
      return { allowed: true, remaining: limit, count: 0 };
    }
    try {
      const count = await this.client.eval(RATE_LIMIT_SCRIPT, 1, key, windowSec);
      const c = Number(count);
      if (c > limit) {
        return { allowed: false, remaining: 0, count: c };
      }
      return { allowed: true, remaining: limit - c, count: c };
    } catch {
      return { allowed: true, remaining: limit, count: 0 };
    }
  }

  /**
   * 获取分布式锁（增强版）：返回 LockHandle，支持看门狗告警和自动续期。
   *
   * @param key 锁 key
   * @param value 锁持有者标识（用于安全释放，防止误删）
   * @param ttlSec 锁 TTL（秒）
   * @param options 可选配置
   * @returns LockHandle（获取成功）或 null（获取失败）
   *
   * 使用示例：
   * ```ts
   * const handle = await redis.acquireLock('task:1', 'user:123', 10, { context: '接单' });
   * if (!handle) throw new ConflictException('任务正在被接单');
   * try {
   *   // 业务逻辑
   * } finally {
   *   await handle.release();
   * }
   * ```
   */
  async acquireLock(
    key: string,
    value: string,
    ttlSec: number,
    options: AcquireLockOptions = {},
  ): Promise<LockHandle | null> {
    const {
      alertThresholdMs = ttlSec * 1000 * 2, // 默认 2 倍 TTL 时长触发告警
      enableWatchdog = true,
      context = '',
    } = options;

    const locked = await this.setNx(key, value, ttlSec);
    if (!locked) {
      if (this.isAvailable()) {
        await this.lockAlert.onLockAcquireFailed(key, value, context);
      }
      return null;
    }

    const handle = new LockHandle(
      this.client,
      this.lockAlert,
      key,
      value,
      ttlSec,
      alertThresholdMs,
      context,
    );

    if (enableWatchdog) {
      handle.startWatchdog();
    }

    return handle;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}