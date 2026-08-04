import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

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

  constructor() {
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

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
