import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * WalletService 单元测试（纯 Mock，无需数据库）
 * 覆盖：余额计算逻辑、类型校验、错误处理、并发安全机制验证
 */
describe('WalletService', () => {
  let service: WalletService;
  let prisma: any;
  let moduleRef: TestingModule;

  const defaultWalletRow = {
    id: 1n,
    user_id: 1001n,
    balance: new Prisma.Decimal(1000),
    frozen: new Prisma.Decimal(0),
    created_at: new Date('2026-08-04T00:00:00Z'),
    updated_at: new Date('2026-08-04T00:00:00Z'),
  };

  const defaultTx = {
    id: 1n,
    walletId: 1n,
    orderId: null,
    type: 'INCOME' as const,
    amount: new Prisma.Decimal(100),
    balanceAfter: new Prisma.Decimal(1100),
    description: '测试充值',
    createdAt: new Date(),
  };

  const createMockTx = (walletRow: any = defaultWalletRow) => ({
    $queryRaw: jest.fn().mockResolvedValue([walletRow]),
    wallet: { update: jest.fn().mockResolvedValue(undefined) },
    transaction: { create: jest.fn().mockResolvedValue(defaultTx) },
  });

  const createPrismaMock = (txFactory?: (cb: Function) => any) => {
    const defaultTxImpl = async (cb: Function) => {
      const tx = createMockTx();
      return cb(tx);
    };

    const factory = txFactory || defaultTxImpl;

    return {
      $transaction: jest.fn().mockImplementation(factory),
      wallet: {
        findUnique: jest.fn().mockResolvedValue(defaultWalletRow),
        upsert: jest.fn().mockResolvedValue({
          ...defaultWalletRow,
          balance: new Prisma.Decimal(0),
          frozen: new Prisma.Decimal(0),
        }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([defaultTx]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
  };

  const compileService = async () => {
    moduleRef = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get<WalletService>(WalletService);
  };

  afterEach(async () => {
    if (moduleRef) await moduleRef.close();
  });

  // ==================== recordTransaction ====================
  describe('recordTransaction', () => {
    it('INCOME 应成功增加余额', async () => {
      prisma = createPrismaMock();
      await compileService();

      const result = await service.recordTransaction(1001n, 'INCOME', 100, '充值');

      expect(result).toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // 获取 tx 对象验证 lockWallet 使用了 $queryRaw FOR UPDATE
      const cb = prisma.$transaction.mock.calls[0][0];
      const tx = createMockTx();
      await cb(tx);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

      // 验证写入流水
      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'INCOME',
          }),
        }),
      );
    });

    it('EXPENSE 应成功扣减余额', async () => {
      prisma = createPrismaMock();
      await compileService();

      await service.recordTransaction(1001n, 'EXPENSE', 100, '消费');

      const cb = prisma.$transaction.mock.calls[0][0];
      const tx = createMockTx();
      await cb(tx);
      expect(tx.wallet.update).toHaveBeenCalled();
    });

    it('余额不足应抛出 ConflictException', async () => {
      const lowBalanceRow = {
        ...defaultWalletRow,
        balance: new Prisma.Decimal(50),
      };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(lowBalanceRow);
        return cb(tx);
      });
      await compileService();

      await expect(service.recordTransaction(1001n, 'EXPENSE', 100, '消费')).rejects.toThrow(
        ConflictException,
      );
    });

    it('FREEZE 余额不足应抛出 ConflictException', async () => {
      const lowBalanceRow = {
        ...defaultWalletRow,
        balance: new Prisma.Decimal(10),
      };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(lowBalanceRow);
        return cb(tx);
      });
      await compileService();

      await expect(service.recordTransaction(1001n, 'FREEZE', 100, '冻结')).rejects.toThrow(
        ConflictException,
      );
    });

    it('UNFREEZE 冻结不足应抛出 ConflictException', async () => {
      const lowFrozenRow = {
        ...defaultWalletRow,
        frozen: new Prisma.Decimal(10),
      };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(lowFrozenRow);
        return cb(tx);
      });
      await compileService();

      await expect(service.recordTransaction(1001n, 'UNFREEZE', 100, '解冻')).rejects.toThrow(
        ConflictException,
      );
    });

    it('钱包不存在应抛出 NotFoundException', async () => {
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = {
          ...createMockTx(),
          $queryRaw: jest.fn().mockResolvedValue([]),
        };
        return cb(tx);
      });
      await compileService();

      await expect(service.recordTransaction(9999n, 'INCOME', 100, '充值')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('FREEZE 应正确减少余额并增加冻结', async () => {
      prisma = createPrismaMock();
      await compileService();

      await service.recordTransaction(1001n, 'FREEZE', 300, '冻结测试');

      const cb = prisma.$transaction.mock.calls[0][0];
      const tx = createMockTx();
      await cb(tx);

      expect(tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balance: new Prisma.Decimal(700),
            frozen: new Prisma.Decimal(300),
          }),
        }),
      );
    });

    it('UNFREEZE 应正确恢复余额并减少冻结', async () => {
      const highFrozenRow = {
        ...defaultWalletRow,
        frozen: new Prisma.Decimal(500),
      };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(highFrozenRow);
        return cb(tx);
      });
      await compileService();

      await service.recordTransaction(1001n, 'UNFREEZE', 300, '解冻测试');

      const cb = prisma.$transaction.mock.calls[0][0];
      const tx = createMockTx(highFrozenRow);
      await cb(tx);

      expect(tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balance: new Prisma.Decimal(1300), // 1000 + 300
            frozen: new Prisma.Decimal(200), // 500 - 300
          }),
        }),
      );
    });
  });

  // ==================== getBalance ====================
  describe('getBalance', () => {
    it('应返回正确的余额信息', async () => {
      prisma = createPrismaMock();
      await compileService();

      const result = await service.getBalance(1001n);

      expect(result).toEqual({
        id: '1',
        balance: 1000,
        frozen: 0,
        available: 1000,
      });
    });

    it('钱包不存在时应自动初始化', async () => {
      prisma = createPrismaMock();
      prisma.wallet.findUnique.mockResolvedValueOnce(null);
      await compileService();

      const result = await service.getBalance(9999n);

      expect(prisma.wallet.upsert).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  // ==================== initWallet ====================
  describe('initWallet', () => {
    it('应调用 upsert 创建钱包', async () => {
      prisma = createPrismaMock();
      await compileService();

      await service.initWallet(1001n);

      expect(prisma.wallet.upsert).toHaveBeenCalledWith({
        where: { userId: 1001n },
        update: {},
        create: expect.objectContaining({ userId: 1001n }),
      });
    });

    it('应返回初始余额为 0', async () => {
      prisma = createPrismaMock();
      await compileService();

      const result = await service.initWallet(1001n);

      expect(result.balance).toBe(0);
      expect(result.frozen).toBe(0);
      expect(result.available).toBe(0);
    });

    it('并发调用应幂等（upsert 天然幂等）', async () => {
      prisma = createPrismaMock();
      await compileService();

      await Promise.all([
        service.initWallet(1001n),
        service.initWallet(1001n),
        service.initWallet(1001n),
      ]);

      expect(prisma.wallet.upsert).toHaveBeenCalledTimes(3);
    });
  });

  // ==================== transfer ====================
  describe('transfer', () => {
    const fromId = 1001n;
    const toId = 1002n;

    it('转账成功应更新双方余额', async () => {
      prisma = createPrismaMock();
      await compileService();

      await service.transfer(fromId, toId, 50, '测试转账');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const cb = prisma.$transaction.mock.calls[0][0];
      const tx = createMockTx();
      await cb(tx);

      expect(tx.wallet.update).toHaveBeenCalledTimes(2);
      expect(tx.transaction.create).toHaveBeenCalledTimes(2);
    });

    it('不能向自己转账', async () => {
      prisma = createPrismaMock();
      await compileService();

      await expect(service.transfer(fromId, fromId, 10, '自己转自己')).rejects.toThrow(
        ConflictException,
      );
    });

    it('余额不足应抛出 ConflictException', async () => {
      const lowBalFrom = {
        ...defaultWalletRow,
        user_id: fromId,
        balance: new Prisma.Decimal(30),
      };
      const normalTo = {
        ...defaultWalletRow,
        user_id: toId,
        balance: new Prisma.Decimal(1000),
      };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([lowBalFrom])
            .mockResolvedValueOnce([normalTo]),
          wallet: { update: jest.fn() },
          transaction: { create: jest.fn() },
        };
        return cb(tx);
      });
      await compileService();

      await expect(service.transfer(fromId, toId, 100, '余额不足')).rejects.toThrow(
        ConflictException,
      );
    });

    it('🔑 验证锁排序：应按 userId 升序获取锁（防 AB-BA 死锁）', async () => {
      prisma = createPrismaMock();
      await compileService();

      const spy = jest.spyOn(service as any, 'lockWallet');

      await service.transfer(fromId, toId, 10, '锁排序测试');

      expect(spy).toHaveBeenCalledTimes(2);
      const firstLockUserId = spy.mock.calls[0][1] as bigint;
      const secondLockUserId = spy.mock.calls[1][1] as bigint;

      // 首次调用的 userId 必须 < 第二次调用的 userId
      expect(firstLockUserId < secondLockUserId).toBe(true);
      expect(firstLockUserId).toBe(fromId); // 1001
      expect(secondLockUserId).toBe(toId); // 1002

      spy.mockRestore();
    });

    it('🔑 反向转账也应升序加锁（fromId > toId 场景）', async () => {
      prisma = createPrismaMock();
      await compileService();

      const spy = jest.spyOn(service as any, 'lockWallet');

      // fromId=1002n > toId=1001n，应仍先锁 1001（小的）
      await service.transfer(1002n, 1001n, 10, '反向转账');

      expect(spy).toHaveBeenCalledTimes(2);
      const firstLockUserId = spy.mock.calls[0][1] as bigint;
      const secondLockUserId = spy.mock.calls[1][1] as bigint;

      expect(firstLockUserId < secondLockUserId).toBe(true);
      expect(firstLockUserId).toBe(1001n);
      expect(secondLockUserId).toBe(1002n);

      spy.mockRestore();
    });

    it('钱包不存在应抛出 NotFoundException', async () => {
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([]) // 第一个钱包不存在
            .mockResolvedValueOnce([defaultWalletRow]),
          wallet: { update: jest.fn() },
          transaction: { create: jest.fn() },
        };
        return cb(tx);
      });
      await compileService();

      await expect(service.transfer(fromId, toId, 10, '钱包不存在')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== getTransactions ====================
  describe('getTransactions', () => {
    it('应返回分页结果', async () => {
      prisma = createPrismaMock();
      prisma.transaction.findMany.mockResolvedValue([defaultTx, { ...defaultTx, id: 2n }]);
      prisma.transaction.count.mockResolvedValue(42);
      await compileService();

      const result = await service.getTransactions(1001n, 2, 20);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(42);
      expect(result.page).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    it('应支持按类型过滤', async () => {
      prisma = createPrismaMock();
      await compileService();

      await service.getTransactions(1001n, 1, 20, 'INCOME');

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'INCOME' }),
        }),
      );
    });
  });

  // ==================== confirmWithdraw ====================
  describe('confirmWithdraw', () => {
    it('应原子完成 UNFREEZE + EXPENSE（2 条流水）', async () => {
      const frozenRow = { ...defaultWalletRow, frozen: new Prisma.Decimal(500) };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(frozenRow);
        return cb(tx);
      });
      await compileService();

      const result = await service.confirmWithdraw(1001n, 100, 'TXN_001');

      expect(result).toBeDefined();

      const cb = prisma.$transaction.mock.calls[0][0];
      const tx = createMockTx(frozenRow);
      await cb(tx);

      expect(tx.transaction.create).toHaveBeenCalledTimes(2);
      const types = tx.transaction.create.mock.calls.map((c: any[]) => c[0].data.type);
      expect(types).toEqual(['UNFREEZE', 'EXPENSE']);

      // 冻结应减少 100（500 -> 400），余额不变（+100 -100）
      expect(tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            frozen: new Prisma.Decimal(400),
          }),
        }),
      );
    });

    it('冻结金额不足应抛出 ConflictException', async () => {
      const lowFrozenRow = { ...defaultWalletRow, frozen: new Prisma.Decimal(50) };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(lowFrozenRow);
        return cb(tx);
      });
      await compileService();

      await expect(service.confirmWithdraw(1001n, 200, 'TXN_002')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ==================== rollbackWithdraw ====================
  describe('rollbackWithdraw', () => {
    it('应完成 UNFREEZE 操作', async () => {
      const frozenRow = { ...defaultWalletRow, frozen: new Prisma.Decimal(300) };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(frozenRow);
        return cb(tx);
      });
      await compileService();

      await service.rollbackWithdraw(1001n, 100);

      const cb = prisma.$transaction.mock.calls[0][0];
      const tx = createMockTx(frozenRow);
      await cb(tx);

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'UNFREEZE' }),
        }),
      );

      // 冻结 300 -> 200，余额 1000 -> 1100
      expect(tx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            frozen: new Prisma.Decimal(200),
            balance: new Prisma.Decimal(1100),
          }),
        }),
      );
    });

    it('冻结不足应抛出 ConflictException', async () => {
      const lowFrozenRow = { ...defaultWalletRow, frozen: new Prisma.Decimal(50) };
      prisma = createPrismaMock(async (cb: Function) => {
        const tx = createMockTx(lowFrozenRow);
        return cb(tx);
      });
      await compileService();

      await expect(service.rollbackWithdraw(1001n, 200)).rejects.toThrow(ConflictException);
    });
  });
});
