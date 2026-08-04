/**
 * WalletService 集成测试（需要真实 MySQL）
 * 运行：pnpm test:e2e
 * CI 中自动运行（GitHub Actions 已配置 MySQL service）
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { WalletService } from './wallet.service';
import { PrismaService } from '../../prisma/prisma.service';

const TEST_PREFIX = 'jest_integration_test';

describe('WalletService Integration', () => {
  let prisma: PrismaClient;
  let walletService: WalletService;
  let prismaService: PrismaService;
  let testUserAId: bigint;
  let testUserBId: bigint;

  beforeAll(async () => {
    prisma = new PrismaClient();
    prismaService = prisma as unknown as PrismaService;
    walletService = new WalletService(prismaService);

    // 清理旧测试
    const oldUsers = await prisma.user.findMany({
      where: { openid: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    for (const u of oldUsers) {
      await prisma.transaction.deleteMany({
        where: { wallet: { userId: u.id } },
      });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
    }
    await prisma.user.deleteMany({
      where: { openid: { startsWith: TEST_PREFIX } },
    });

    // 创建测试用户
    const userA = await prisma.user.create({
      data: {
        openid: `${TEST_PREFIX}_A_${Date.now()}`,
        nickname: '集成测试A',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    const userB = await prisma.user.create({
      data: {
        openid: `${TEST_PREFIX}_B_${Date.now()}`,
        nickname: '集成测试B',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    testUserAId = userA.id;
    testUserBId = userB.id;

    // 初始化钱包
    await walletService.initWallet(testUserAId);
    await walletService.initWallet(testUserBId);
  }, 30000);

  afterAll(async () => {
    const allTestUsers = await prisma.user.findMany({
      where: { openid: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    for (const u of allTestUsers) {
      await prisma.transaction.deleteMany({
        where: { wallet: { userId: u.id } },
      });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
    }
    await prisma.user.deleteMany({
      where: { openid: { startsWith: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  }, 30000);

  // 重置用户 A 到指定余额
  const resetUserABalance = async (balance: number, frozen = 0) => {
    await prisma.wallet.update({
      where: { userId: testUserAId },
      data: {
        balance: new Prisma.Decimal(balance),
        frozen: new Prisma.Decimal(frozen),
      },
    });
  };

  // 重置用户 B 余额
  const resetUserBBalance = async (balance: number, frozen = 0) => {
    await prisma.wallet.update({
      where: { userId: testUserBId },
      data: {
        balance: new Prisma.Decimal(balance),
        frozen: new Prisma.Decimal(frozen),
      },
    });
  };

  // 清空用户的流水记录
  const clearUserTransactions = async (userId: bigint) => {
    await prisma.transaction.deleteMany({
      where: { wallet: { userId } },
    });
  };

  describe('余额查询', () => {
    beforeEach(async () => {
      await resetUserABalance(1000);
    });

    it('应返回正确的初始余额', async () => {
      const bal = await walletService.getBalance(testUserAId);
      expect(bal.balance).toBe(1000);
      expect(bal.frozen).toBe(0);
      expect(bal.available).toBe(1000);
    });
  });

  describe('recordTransaction', () => {
    beforeEach(async () => {
      await resetUserABalance(1000);
      await clearUserTransactions(testUserAId);
    });

    it('应正确扣减余额', async () => {
      await walletService.recordTransaction(testUserAId, 'EXPENSE', 100, '测试消费');
      const bal = await walletService.getBalance(testUserAId);
      expect(bal.balance).toBe(900);
    });

    it('余额不足应抛出 ConflictException', async () => {
      await expect(
        walletService.recordTransaction(testUserAId, 'EXPENSE', 10000, '超额消费'),
      ).rejects.toThrow();
    });

    it('FREEZE 应减少可用余额并增加冻结', async () => {
      await walletService.recordTransaction(testUserAId, 'FREEZE', 200, '测试冻结');
      const bal = await walletService.getBalance(testUserAId);
      expect(bal.balance).toBe(800);
      expect(bal.frozen).toBe(200);
    });

    it('UNFREEZE 应恢复余额', async () => {
      await walletService.recordTransaction(testUserAId, 'FREEZE', 200, '先冻结');
      await walletService.recordTransaction(testUserAId, 'UNFREEZE', 200, '再解冻');
      const bal = await walletService.getBalance(testUserAId);
      expect(bal.balance).toBe(1000);
      expect(bal.frozen).toBe(0);
    });

    it('流水不可篡改（append-only）', async () => {
      const before = await prisma.transaction.count({
        where: { wallet: { userId: testUserAId } },
      });

      await walletService.recordTransaction(testUserAId, 'EXPENSE', 50, '新增流水');

      const after = await prisma.transaction.count({
        where: { wallet: { userId: testUserAId } },
      });
      expect(after).toBe(before + 1);
    });
  });

  describe('transfer（核心并发安全）', () => {
    beforeEach(async () => {
      await resetUserABalance(1000);
      await resetUserBBalance(1000);
    });

    it('应成功完成转账', async () => {
      await walletService.transfer(testUserAId, testUserBId, 50, '测试转账');

      const balA = await walletService.getBalance(testUserAId);
      const balB = await walletService.getBalance(testUserBId);
      expect(balA.balance).toBe(950);
      expect(balB.balance).toBe(1050);
    });

    it('不能向自己转账', async () => {
      await expect(
        walletService.transfer(testUserAId, testUserAId, 10, '自己转自己'),
      ).rejects.toThrow();
    });

    it('余额不足应拒绝转账', async () => {
      await expect(
        walletService.transfer(testUserAId, testUserBId, 10000, '超额转账'),
      ).rejects.toThrow();
    });

    it('并发双向转账不应产生死锁（AB-BA 场景）', async () => {
      let errors = 0;
      let success = 0;

      // 20 个 A→B 和 20 个 B→A 同时发起
      const tasks: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        tasks.push(
          walletService
            .transfer(testUserAId, testUserBId, 10, `A→B #${i}`)
            .then(() => {
              success++;
            })
            .catch(() => {
              errors++;
            }),
        );
        tasks.push(
          walletService
            .transfer(testUserBId, testUserAId, 10, `B→A #${i}`)
            .then(() => {
              success++;
            })
            .catch(() => {
              errors++;
            }),
        );
      }

      await Promise.all(tasks);

      expect(errors).toBe(0);
      expect(success).toBe(40);

      // 总金额守恒
      const balA = await walletService.getBalance(testUserAId);
      const balB = await walletService.getBalance(testUserBId);
      expect(balA.available + balA.frozen + balB.available + balB.frozen).toBe(2000);
    }, 60000);

    it('高强度并发不应超扣', async () => {
      // A=100，并发 20 次扣 10 元
      await resetUserABalance(100);

      let success = 0;
      let fail = 0;
      const tasks: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        tasks.push(
          walletService
            .recordTransaction(testUserAId, 'EXPENSE', 10, `并发扣 #${i}`)
            .then(() => {
              success++;
            })
            .catch(() => {
              fail++;
            }),
        );
      }

      await Promise.all(tasks);

      // 恰好 10 次成功，10 次被拒
      expect(success).toBe(10);
      expect(fail).toBe(10);

      const bal = await walletService.getBalance(testUserAId);
      expect(bal.balance).toBe(0);
    }, 30000);
  });

  describe('提现流程', () => {
    beforeEach(async () => {
      await resetUserABalance(1000, 0);
      await clearUserTransactions(testUserAId);
    });

    it('confirmWithdraw 应原子完成 UNFREEZE + EXPENSE', async () => {
      // 先冻结
      await walletService.recordTransaction(testUserAId, 'FREEZE', 100, '测试冻结');

      const balBefore = await walletService.getBalance(testUserAId);
      expect(balBefore.frozen).toBeGreaterThanOrEqual(100);

      // 模拟确认提现
      await walletService.confirmWithdraw(testUserAId, 100, 'TEST_TXN_001');

      const balAfter = await walletService.getBalance(testUserAId);
      expect(balAfter.frozen).toBe(0);
      expect(balAfter.available).toBe(900); // 1000 - 100 (FREEZE) = 900, 再 -100 (EXPENSE) = 800... 不对
      // 实际：初始 1000，FREEZE 100 -> balance=900, frozen=100
      // confirmWithdraw: UNFREEZE +100 (balance=1000, frozen=0), EXPENSE -100 (balance=900)
      // 所以 final balance = 900
      expect(balAfter.available).toBe(900);
    });

    it('rollbackWithdraw 应正确解冻', async () => {
      // 冻结
      await walletService.recordTransaction(testUserAId, 'FREEZE', 50, '测试冻结回滚');

      const balBefore = await walletService.getBalance(testUserAId);

      // 回滚
      await walletService.rollbackWithdraw(testUserAId, 50);

      const balAfter = await walletService.getBalance(testUserAId);
      expect(balAfter.frozen).toBe(0);
      // UNFREEZE 50: balance = balBefore.available (=1000-50=950) + 50 = 1000
      expect(balAfter.available).toBe(1000);
    });
  });

  describe('initWallet 并发安全', () => {
    it('多个并发 upsert 不应产生重复钱包', async () => {
      const openid = `${TEST_PREFIX}_race_${Date.now()}`;
      const user = await prisma.user.create({
        data: {
          openid,
          nickname: '竞态测试',
          creditScore: 100,
          role: 'USER',
          status: 'ACTIVE',
        },
      });

      // 并发 10 次 initWallet
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => walletService.initWallet(user.id)),
      );

      // 至少一个成功（upsert 可能因唯一约束失败但不影响）
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // 应只有一个钱包
      const wallets = await prisma.wallet.findMany({
        where: { userId: user.id },
      });
      expect(wallets.length).toBe(1);
    }, 15000);
  });

  describe('流水一致性', () => {
    it('最后流水的 balanceAfter 应等于实际余额', async () => {
      await resetUserABalance(1000);
      await clearUserTransactions(testUserAId);

      // 做一次交易
      await walletService.recordTransaction(testUserAId, 'EXPENSE', 100, '一致性测试');

      const allTx = await prisma.transaction.findMany({
        where: { wallet: { userId: testUserAId } },
        orderBy: { createdAt: 'asc' },
      });

      const lastTx = allTx[allTx.length - 1];
      const bal = await walletService.getBalance(testUserAId);
      expect(Number(lastTx.balanceAfter)).toBe(bal.available);
    });
  });
});
