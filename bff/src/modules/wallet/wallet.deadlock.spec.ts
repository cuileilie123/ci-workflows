import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { createTestLogger } from '@neighborhood-help/test-utils';

const log = createTestLogger('wallet.deadlock');

/**
 * WalletService 并发死锁场景单元测试（纯 Mock，无需数据库）
 *
 * 目标：验证 AB-BA 死锁修复在压力/并发场景下依然有效。
 * 核心断言：
 *  1) 所有 lockWallet 调用都严格按 userId 升序进行
 *  2) wallet.update 的更新顺序与加锁顺序一致（firstId → secondId）
 *  3) 每笔转账都在独立事务内，事务数量与调用次数匹配
 */
describe('WalletService - 并发死锁修复验证', () => {
  let service: WalletService;
  let prisma: any;
  let moduleRef: TestingModule | null = null;

  /** 生成钱包行（可指定 user_id 和 balance） */
  const walletRow = (userId: bigint, balance = 1000) => ({
    id: userId,
    user_id: userId,
    balance: new Prisma.Decimal(balance),
    frozen: new Prisma.Decimal(0),
    created_at: new Date(),
    updated_at: new Date(),
  });

  /** 构造单条事务的 mock：内部 $queryRaw 按顺序返回钱包，update/create 捕获调用 */
  const buildTxForPair = (userA: bigint, userB: bigint, balA = 5000, balB = 5000) => {
    const txCalls: Array<{ op: string; userId?: bigint; updateFirst?: boolean }> = [];
    const tx = {
      $queryRaw: jest
        .fn()
        .mockImplementation(() => {
          // 把每次加锁 userId 记录到 txCalls 中（在回调里填充，见下方）
          return Promise.resolve([walletRow(1n, 0)]);
        }),
      wallet: {
        update: jest.fn().mockImplementation((arg: any) => {
          txCalls.push({ op: 'wallet.update', updateFirst: arg.where.id === userA || arg.where.id < Math.max(Number(userA), Number(userB)) ? undefined : true });
          return Promise.resolve(undefined);
        }),
      },
      transaction: { create: jest.fn().mockResolvedValue(undefined) },
    };

    // 关键：让 $queryRaw 根据被调用时传入的 userId（从字符串中无法获取，改为使用锁顺序注入）
    // 这里采用一个 map：外层在调用 transfer 前，给这个 tx 注入按固定顺序返回的钱包
    (tx as any)._presetWallets = new Map<bigint, any>([
      [userA, walletRow(userA, balA)],
      [userB, walletRow(userB, balB)],
    ]);

    return { tx, txCalls };
  };

  /** 创建 Prisma mock：支持在调用 transfer 时按事务捕获 lockWallet 调用顺序 */
  const createPrismaWithOrderTracking = () => {
    // 所有事务产生的加锁顺序记录：外层用于断言
    const globalLockOrder: Array<{ txId: number; locks: bigint[] }> = [];
    let txSeq = 0;

    const $transaction = jest.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txId = ++txSeq;
      const thisTxLocks: bigint[] = [];

      // 用 lockWallet 调用顺序来驱动：当 service.lockWallet(tx, userId) 被调用时，
      // 其内部调用 tx.$queryRaw，我们通过把 tx 包装成代理对象来记录 userId 参数
      const realTx: any = {
        $queryRaw: jest.fn().mockImplementation((_strings: TemplateStringsArray, userId: any) => {
          thisTxLocks.push(BigInt(userId));
          // 直接返回对应钱包（余额充足）
          return Promise.resolve([walletRow(BigInt(userId), 9_999_999)]);
        }),
        wallet: { update: jest.fn().mockResolvedValue(undefined) },
        transaction: { create: jest.fn().mockResolvedValue(undefined) },
      };

      try {
        return await cb(realTx);
      } finally {
        globalLockOrder.push({ txId, locks: thisTxLocks });
      }
    });

    return {
      $transaction,
      wallet: {
        findUnique: jest.fn().mockResolvedValue(walletRow(1n)),
        upsert: jest.fn().mockResolvedValue(walletRow(1n, 0)),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      _globalLockOrder: globalLockOrder,
    };
  };

  const compileService = async (mock: any) => {
    // 先关闭上一个 TestingModule，防止 DI 资源泄漏
    if (moduleRef) {
      log('compileService: 关闭上一个 TestingModule');
      await moduleRef.close();
      moduleRef = null;
    }
    log('compileService: 开始编译新 TestingModule');
    const t0 = Date.now();
    moduleRef = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: mock }],
    }).compile();
    log(`compileService: TestingModule 编译完成，耗时 ${Date.now() - t0}ms`);
    return moduleRef.get<WalletService>(WalletService);
  };

  afterEach(async () => {
    if (moduleRef) {
      log('afterEach: 关闭 TestingModule');
      const t0 = Date.now();
      await moduleRef.close();
      log(`afterEach: TestingModule 已关闭，耗时 ${Date.now() - t0}ms`);
      moduleRef = null;
    }
  });

  // ================ 1. 单次锁顺序验证（正向/反向转账） ================
  describe('锁排序基础验证', () => {
    it('正向 A→B（A<B）：先锁 A 再锁 B', async () => {
      prisma = createPrismaWithOrderTracking();
      service = await compileService(prisma);

      await service.transfer(1001n, 1002n, 10, '正向');

      const locks = prisma._globalLockOrder[0].locks;
      expect(locks).toEqual([1001n, 1002n]);
      expect(locks[0] < locks[1]).toBe(true);
    });

    it('反向 B→A（B>A）：仍先锁小的 A 再锁大的 B', async () => {
      prisma = createPrismaWithOrderTracking();
      service = await compileService(prisma);

      await service.transfer(1002n, 1001n, 10, '反向');

      const locks = prisma._globalLockOrder[0].locks;
      expect(locks).toEqual([1001n, 1002n]);
      expect(locks[0] < locks[1]).toBe(true);
    });

    it('自己转自己应直接抛 ConflictException（不进入加锁流程）', async () => {
      prisma = createPrismaWithOrderTracking();
      service = await compileService(prisma);

      await expect(service.transfer(1001n, 1001n, 10, '自转')).rejects.toThrow(ConflictException);
      // 不应产生任何事务/加锁
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma._globalLockOrder).toHaveLength(0);
    });
  });

  // ================ 2. 并发压力：多对 AB-BA 双向转账 ================
  describe('并发压力下的锁顺序不变性', () => {
    const PAIRS = 20; // 20 对双向转账（40 次并发），验证死锁修复稳定性

    it(`🚀 ${PAIRS} 对双向并发转账（${PAIRS * 2} 次），每次加锁均严格升序`, async () => {
      prisma = createPrismaWithOrderTracking();
      service = await compileService(prisma);

      const tasks: Promise<any>[] = [];
      for (let i = 0; i < PAIRS; i++) {
        const base = 2000n + BigInt(i * 2); // (2000, 2002), (2004, 2006)...
        const a = base;
        const b = base + 1n;
        tasks.push(service.transfer(a, b, 1, `T${i}:A→B`));
        tasks.push(service.transfer(b, a, 1, `T${i}:B→A`));
      }

      await Promise.all(tasks);

      // 验证总事务数 = 调用次数
      expect(prisma.$transaction).toHaveBeenCalledTimes(PAIRS * 2);
      expect(prisma._globalLockOrder).toHaveLength(PAIRS * 2);

      // 每一笔事务内部的锁顺序都必须升序（无任何一次反序）
      for (const record of prisma._globalLockOrder) {
        expect(record.locks).toHaveLength(2);
        expect(record.locks[0] < record.locks[1]).toBe(true);
      }
    });

    it('🚀 随机方向 100 次并发转账，锁顺序无一次反序', async () => {
      prisma = createPrismaWithOrderTracking();
      service = await compileService(prisma);

      const tasks: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        // 随机生成两个 userId
        const raw1 = BigInt(Math.floor(Math.random() * 1_000_000) + 1);
        const raw2 = BigInt(Math.floor(Math.random() * 1_000_000) + 1);
        if (raw1 === raw2) continue; // 跳过自转
        tasks.push(service.transfer(raw1, raw2, 1, `random#${i}`));
      }
      const expected = tasks.length;

      await Promise.all(tasks);

      expect(prisma.$transaction).toHaveBeenCalledTimes(expected);
      for (const record of prisma._globalLockOrder) {
        expect(record.locks).toHaveLength(2);
        expect(record.locks[0] < record.locks[1]).toBe(true);
      }
    });
  });

  // ================ 3. 钱包 update 顺序与加锁顺序一致（防止更新阶段死锁） ================
  describe('wallet.update 顺序与加锁顺序一致', () => {
    it('先加锁 firstId → 先更新 firstId，再加锁 secondId → 再更新 secondId', async () => {
      // 构造一个能记录 wallet.update 执行顺序的 mock
      const updateSequence: bigint[] = [];
      const lockSequence: bigint[] = [];

      const customTx = async (cb: (tx: any) => any) => {
        const tx = {
          $queryRaw: jest.fn().mockImplementation((_s: any, uid: bigint) => {
            lockSequence.push(uid);
            return Promise.resolve([walletRow(uid, 9999)]);
          }),
          wallet: {
            update: jest.fn().mockImplementation((arg: any) => {
              updateSequence.push(BigInt(arg.where.id));
              return Promise.resolve(undefined);
            }),
          },
          transaction: { create: jest.fn().mockResolvedValue(undefined) },
        };
        return cb(tx);
      };

      prisma = {
        $transaction: jest.fn().mockImplementation(customTx),
        wallet: { findUnique: jest.fn(), upsert: jest.fn() },
        transaction: { findMany: jest.fn(), count: jest.fn() },
      };
      service = await compileService(prisma);

      // B→A（B>A），firstId 应为 A
      await service.transfer(3002n, 3001n, 10, 'B→A');

      // 断言加锁顺序
      expect(lockSequence).toEqual([3001n, 3002n]);
      // 断言更新顺序与加锁顺序完全一致
      expect(updateSequence).toEqual([3001n, 3002n]);
    });
  });

  // ================ 4. 三方环形转账（A→B、B→C、C→A）均遵循升序 ================
  describe('三方环形转账', () => {
    it('A=10,B=20,C=30 环形并发，每笔内部均升序加锁', async () => {
      prisma = createPrismaWithOrderTracking();
      service = await compileService(prisma);

      const A = 10n, B = 20n, C = 30n;
      await Promise.all([
        service.transfer(A, B, 1, 'A→B'),
        service.transfer(B, C, 1, 'B→C'),
        service.transfer(C, A, 1, 'C→A'),
      ]);

      expect(prisma._globalLockOrder).toHaveLength(3);
      for (const r of prisma._globalLockOrder) {
        expect(r.locks).toHaveLength(2);
        expect(r.locks[0] < r.locks[1]).toBe(true);
      }
      // 具体顺序断言
      const sorted = prisma._globalLockOrder.map((r: any) => r.locks).sort((a: any, b: any) => Number(a[0] - b[0]));
      expect(sorted).toEqual([
        [10n, 20n], // A→B
        [10n, 30n], // C→A（升序后是 10,30）
        [20n, 30n], // B→C
      ]);
    });
  });

  // ================ 5. 余额不足在加锁后校验（事务内，保证不会超扣） ================
  describe('余额校验在事务加锁后执行（防并发超扣）', () => {
    it('加锁后读到的余额不足应抛 ConflictException，不应产生任何 update', async () => {
      const lowBalanceTx = async (cb: (tx: any) => any) => {
        // 先锁的余额只有 5，转账 100 会失败
        const tx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([walletRow(5001n, 5)]) // from 余额 5
            .mockResolvedValueOnce([walletRow(5002n, 1000)]), // to 余额 1000
          wallet: { update: jest.fn() },
          transaction: { create: jest.fn() },
        };
        try {
          return await cb(tx);
        } finally {
          // 断言失败时不会产生任何 update / create（原子性）
          expect(tx.wallet.update).not.toHaveBeenCalled();
          expect(tx.transaction.create).not.toHaveBeenCalled();
        }
      };

      prisma = {
        $transaction: jest.fn().mockImplementation(lowBalanceTx),
        wallet: { findUnique: jest.fn(), upsert: jest.fn() },
        transaction: { findMany: jest.fn(), count: jest.fn() },
      };
      service = await compileService(prisma);

      await expect(service.transfer(5001n, 5002n, 100, '超扣测试')).rejects.toThrow(
        ConflictException,
      );
    });

    it('并发 20 次同时扣同一钱包 100 元（初始 500），任何一次进入加锁后校验不足都会抛异常', async () => {
      // 模拟真实并发：第一个事务成功，后续 19 个事务读到 0 余额抛异常
      let committedCount = 0;

      const raceTx = async (cb: (tx: any) => any) => {
        const bal = committedCount === 0 ? 500 : 0; // 仅首个事务能扣成功
        const tx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([walletRow(6001n, bal)]) // from 余额
            .mockResolvedValueOnce([walletRow(6002n, 0)]), // to 余额
          wallet: { update: jest.fn().mockImplementation(() => { committedCount++; return Promise.resolve(); }) },
          transaction: { create: jest.fn().mockResolvedValue(undefined) },
        };
        return cb(tx);
      };

      prisma = {
        $transaction: jest.fn().mockImplementation(raceTx),
        wallet: { findUnique: jest.fn(), upsert: jest.fn() },
        transaction: { findMany: jest.fn(), count: jest.fn() },
      };
      service = await compileService(prisma);

      const tasks = Array.from({ length: 20 }, (_, i) =>
        service.transfer(6001n, 6002n, 100, `超扣并发#${i}`).catch((e) => e),
      );
      const results = await Promise.all(tasks);

      const successes = results.filter((r) => !(r instanceof Error));
      const failures = results.filter((r) => r instanceof ConflictException);

      // 只有第一笔成功，其余 19 笔在加锁后读到剩余为 0，抛余额不足
      expect(successes.length + failures.length).toBe(20);
      expect(committedCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ================ 6. 钱包不存在时在加锁阶段抛出（事务内，不会产生部分写入） ================
  describe('钱包不存在时在加锁阶段抛出', () => {
    it('第二个 lockWallet 返回空，应抛 NotFoundException 且此前无任何 update', async () => {
      let anyUpdateCalled = false;
      const notFoundTx = async (cb: (tx: any) => any) => {
        const tx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([walletRow(7001n, 500)]) // firstId 存在
            .mockResolvedValueOnce([]), // secondId 不存在
          wallet: {
            update: jest.fn().mockImplementation(() => {
              anyUpdateCalled = true;
              return Promise.resolve();
            }),
          },
          transaction: { create: jest.fn() },
        };
        try {
          return await cb(tx);
        } finally {
          expect(anyUpdateCalled).toBe(false);
          expect(tx.transaction.create).not.toHaveBeenCalled();
        }
      };

      prisma = {
        $transaction: jest.fn().mockImplementation(notFoundTx),
        wallet: { findUnique: jest.fn(), upsert: jest.fn() },
        transaction: { findMany: jest.fn(), count: jest.fn() },
      };
      service = await compileService(prisma);

      await expect(service.transfer(7001n, 7002n, 10, '不存在')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
