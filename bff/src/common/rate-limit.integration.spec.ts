/**
 * 限流功能集成测试（需要真实 Redis 实例）
 *
 * 启动前请确保：
 *   1. Redis 在 localhost:6379 运行（可通过 Docker 启动）
 *   2. 设置环境变量：REDIS_HOST=localhost REDIS_PORT=6379
 *
 * 运行命令：
 *   pnpm test:e2e -- --testPathPatterns="rate-limit" --forceExit
 */

import { Test, TestingModule } from '@nestjs/testing';
import { LockAlertService } from './lock-alert.service';
import { RedisService } from './redis.service';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

// 生成唯一 key 后缀，避免测试间 key 冲突
let keyCounter = 0;
const uniqueKey = (base: string) => `${base}:${Date.now()}:${keyCounter++}`;

describe('限流集成测试（真实 Redis）', () => {
  let redisService: RedisService;
  const usedKeys: string[] = [];

  beforeAll(async () => {
    process.env.REDIS_HOST = REDIS_HOST;
    process.env.REDIS_PORT = String(REDIS_PORT);

    const module: TestingModule = await Test.createTestingModule({
      providers: [RedisService, LockAlertService],
    }).compile();

    redisService = module.get<RedisService>(RedisService);

    // 等待 Redis 连接就绪（最多 10 秒）
    await new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (redisService.isAvailable()) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - start > 10000) {
          clearInterval(timer);
          reject(new Error('Redis 连接超时（10s），请确认 Redis 已在 localhost:6379 运行'));
        }
      }, 200);
    });
  }, 15000);

  afterEach(async () => {
    // 清理本测试用过的 key
    for (const key of usedKeys) {
      try {
        await redisService.del(key);
      } catch {
        // 忽略
      }
    }
    usedKeys.length = 0;
  });

  afterAll(async () => {
    await redisService.del('test:ratelimit:cleanup');
  });

  it('✅ 首次请求应放行并返回正确计数', async () => {
    const key = uniqueKey('test:ratelimit');
    usedKeys.push(key);

    const r = await redisService.rateLimit(key, 3, 3600);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.remaining).toBe(2);
  });

  it('✅ 未达上限应持续放行', async () => {
    const key = uniqueKey('test:ratelimit');
    usedKeys.push(key);

    const r1 = await redisService.rateLimit(key, 3, 3600);
    const r2 = await redisService.rateLimit(key, 3, 3600);
    const r3 = await redisService.rateLimit(key, 3, 3600);

    expect(r1.allowed && r2.allowed && r3.allowed).toBe(true);
    expect(r1.count).toBe(1);
    expect(r2.count).toBe(2);
    expect(r3.count).toBe(3);
    expect(r3.remaining).toBe(0);
  });

  it('✅ 超过上限应拒绝（allowed=false）', async () => {
    const key = uniqueKey('test:ratelimit');
    usedKeys.push(key);

    // 用完 3 次配额
    for (let i = 0; i < 3; i++) {
      const r = await redisService.rateLimit(key, 3, 3600);
      expect(r.allowed).toBe(true);
    }

    // 第 4 次应被拒绝
    const r4 = await redisService.rateLimit(key, 3, 3600);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.count).toBe(4);
  });

  it('✅ 不同 key 独立计数互不影响', async () => {
    const keyA = uniqueKey('test:ratelimit:A');
    const keyB = uniqueKey('test:ratelimit:B');
    usedKeys.push(keyA, keyB);

    // keyA 用完 2 次配额
    await redisService.rateLimit(keyA, 2, 3600);
    await redisService.rateLimit(keyA, 2, 3600);
    const rA3 = await redisService.rateLimit(keyA, 2, 3600);
    expect(rA3.allowed).toBe(false);

    // keyB 仍可正常使用
    const rB1 = await redisService.rateLimit(keyB, 2, 3600);
    expect(rB1.allowed).toBe(true);
    expect(rB1.count).toBe(1);
    expect(rB1.remaining).toBe(1);
  });

  it('✅ 窗口过期后配额应恢复', async () => {
    const key = uniqueKey('test:ratelimit:expire');
    usedKeys.push(key);

    // 使用 2 秒的短窗口
    const r1 = await redisService.rateLimit(key, 1, 2);
    expect(r1.allowed).toBe(true);
    expect(r1.count).toBe(1);

    // 配额已用完，应被拒绝
    const r2 = await redisService.rateLimit(key, 1, 2);
    expect(r2.allowed).toBe(false);

    // 等待窗口过期
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // 窗口过期后应重新放行
    const r3 = await redisService.rateLimit(key, 1, 2);
    expect(r3.allowed).toBe(true);
    expect(r3.count).toBe(1);
  }, 10000);

  it('✅ 模拟提现限流：每小时 3 次的场景', async () => {
    const key = `ratelimit:withdraw:99999:${Date.now()}`;
    usedKeys.push(key);

    const LIMIT = 3;
    const WINDOW = 3600;

    // 前 3 次提现应放行
    for (let i = 0; i < LIMIT; i++) {
      const r = await redisService.rateLimit(key, LIMIT, WINDOW);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(LIMIT - 1 - i);
    }

    // 第 4 次提现应被拒绝（对应 controller 抛 429）
    const blocked = await redisService.rateLimit(key, LIMIT, WINDOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(LIMIT + 1);
  });
});
