import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WxPayUtil } from './wx-pay.util';
import { ProfitSharingService } from '../admin/profit-sharing/profit-sharing.service';
import { FinanceSettingsService } from '../admin/finance-settings/finance-settings.service';
import { MetricsService } from '../../common/metrics.service';
import { Prisma } from '@prisma/client';
import { createTestLogger } from '@neighborhood-help/test-utils';

const log = createTestLogger('payment.deadlock');

/**
 * PaymentService 并发死锁场景单元测试（纯 Mock，无需数据库）
 *
 * 目标：验证支付回调与超时订单取消中的跨表死锁修复在并发/压力下依然有效。
 * 核心断言：
 *  1) handleNotify 每次调用都在单个 $transaction 内完成 order.update → task.update → wallet流水
 *  2) 跨表更新顺序严格：order（先）→ task（后），防止 AB-BA 死锁
 *  3) cancelExpiredOrders 每个订单的 order.update → task.update 都在独立事务中，且顺序不变
 *  4) 并发回调多订单时，每一单内部顺序均不反转
 */
describe('PaymentService - 并发死锁修复验证', () => {
  let service: PaymentService;
  let prisma: any;
  let wxPay: any;
  let moduleRef: TestingModule | null = null;

  const defaultTask = {
    id: 100n,
    title: '测试任务',
    status: 'ASSIGNED',
    helperId: 2001n,
    publisherId: 1001n,
    price: new Prisma.Decimal(100),
  };

  const defaultOrder = (overrides: Partial<any> = {}) => ({
    id: 1n,
    orderNo: 'AB12345678',
    taskId: 100n,
    helperId: 2001n,
    totalAmount: new Prisma.Decimal(100),
    platformFee: new Prisma.Decimal(10),
    status: 'PENDING',
    paidAt: null,
    ...overrides,
  });

  const defaultWallet = (userId = 2001n) => ({
    id: userId,
    userId,
    balance: new Prisma.Decimal(0),
    frozen: new Prisma.Decimal(0),
  });

  /** 构造带顺序追踪的 Prisma mock：记录每个事务内的操作顺序 */
  const buildOrderTrackingPrisma = () => {
    // 全局顺序记录，每次 $transaction 调用产生一条 sub-sequence
    const txOpRecords: Array<{ txId: number; ops: Array<{ op: 'order.update' | 'task.update' | 'findUnique' | 'wallet.*' | 'transaction.*'; id?: bigint }> }> = [];
    let txSeq = 0;
    // 外部裸调用（不在 $transaction 内）的记录
    const nonTxOps: any[] = [];

    const buildTxScope = () => {
      const txId = ++txSeq;
      const ops: typeof txOpRecords[number]['ops'] = [];

      const tx: any = {
        order: {
          update: jest.fn().mockImplementation((arg: any) => {
            ops.push({ op: 'order.update', id: arg.where.id });
            return Promise.resolve(defaultOrder({ id: arg.where.id, status: 'PAID' }));
          }),
          findUnique: jest.fn().mockImplementation((arg: any) => {
            ops.push({ op: 'findUnique', id: arg.where.id });
            return Promise.resolve(defaultOrder({ id: arg.where.id, taskId: 100n, helperId: 2001n }));
          }),
        },
        task: {
          update: jest.fn().mockImplementation((arg: any) => {
            ops.push({ op: 'task.update', id: arg.where.id });
            return Promise.resolve({ ...defaultTask, status: 'IN_PROGRESS' });
          }),
          findUnique: jest.fn().mockResolvedValue(defaultTask),
        },
        wallet: {
          findUnique: jest.fn().mockImplementation((arg: any) => {
            ops.push({ op: 'wallet.*' });
            return Promise.resolve(defaultWallet(arg.where.userId));
          }),
          create: jest.fn().mockImplementation((arg: any) => {
            ops.push({ op: 'wallet.*' });
            return Promise.resolve(defaultWallet(arg.data.userId));
          }),
          update: jest.fn().mockImplementation(() => {
            ops.push({ op: 'wallet.*' });
            return Promise.resolve(undefined);
          }),
        },
        transaction: {
          create: jest.fn().mockImplementation(() => {
            ops.push({ op: 'transaction.*' });
            return Promise.resolve(undefined);
          }),
        },
      };

      // 注册：在回调完成后把这条事务的操作序列推入全局
      (tx as any)._txId = txId;
      (tx as any)._ops = ops;
      return { tx, txId, ops };
    };

    const prismaMock: any = {
      $transaction: jest.fn().mockImplementation(async (cb: (tx: any) => Promise<any>) => {
        const { tx, txId, ops } = buildTxScope();
        try {
          return await cb(tx);
        } finally {
          txOpRecords.push({ txId, ops });
        }
      }),

      order: {
        findUnique: jest.fn().mockImplementation((a) => { nonTxOps.push({ op: 'prisma.order.findUnique', ...a }); return Promise.resolve(defaultOrder()); }),
        create: jest.fn().mockImplementation((a) => { nonTxOps.push({ op: 'prisma.order.create' }); return Promise.resolve(defaultOrder()); }),
        update: jest.fn().mockImplementation((a) => { nonTxOps.push({ op: 'prisma.order.update' }); return Promise.resolve(defaultOrder()); }),
        findMany: jest.fn().mockImplementation(() => { nonTxOps.push({ op: 'prisma.order.findMany' }); return Promise.resolve([]); }),
      },
      task: {
        findUnique: jest.fn().mockResolvedValue(defaultTask),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 1001n, openid: 'mock_openid' }),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(defaultWallet()),
        create: jest.fn().mockResolvedValue(defaultWallet()),
        update: jest.fn().mockResolvedValue(undefined),
      },
      transaction: {
        create: jest.fn().mockResolvedValue(undefined),
      },

      _txOpRecords: txOpRecords,
      _nonTxOps: nonTxOps,
    };

    return prismaMock;
  };

  /** 构造 WxPayUtil mock：验签始终通过，解密返回指定 out_trade_no / trade_state */
  const buildWxPayMock = (decryptOverride?: Partial<any>) => ({
    verifySignature: jest.fn().mockReturnValue(true),
    decryptResource: jest.fn().mockReturnValue({
      out_trade_no: '1',
      trade_state: 'SUCCESS',
      ...decryptOverride,
    }),
    signForFrontend: jest.fn().mockReturnValue({
      appId: 'mock',
      timeStamp: 'mock',
      nonceStr: 'mock',
      package: 'mock',
      signType: 'RSA',
      paySign: 'mock',
    }),
    buildAuthorization: jest.fn(),
  });

  const compileService = async () => {
    // 先关闭上一个 TestingModule，防止 DI 资源泄漏
    if (moduleRef) {
      log('compileService: 关闭上一个 TestingModule');
      await moduleRef.close();
      moduleRef = null;
    }
    log('compileService: 开始编译新 TestingModule');
    const t0 = Date.now();
    moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: WxPayUtil, useValue: wxPay },
        {
          provide: ProfitSharingService,
          useValue: {
            calculate: jest.fn().mockResolvedValue({
              platformFee: 10,
              wechatFee: 0.6,
              helperAmount: 89.4,
              ruleId: '1',
              mode: 'FLAT',
              platformRate: 0.1,
              helperRate: 0.9,
            }),
          },
        },
        {
          provide: FinanceSettingsService,
          useValue: {
            getActiveProfitSharingReceiver: jest.fn().mockResolvedValue({
              enabled: false,
              mchId: '',
              name: '平台佣金账户',
            }),
            getActiveMainMchId: jest.fn().mockResolvedValue(''),
            getActiveAppId: jest.fn().mockResolvedValue(''),
            clearMainConfigCache: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            recordSuccess: jest.fn(),
            recordFail: jest.fn(),
            recordException: jest.fn(),
          },
        },
      ],
    }).compile();
    log(`compileService: TestingModule 编译完成，耗时 ${Date.now() - t0}ms`);
    return moduleRef.get<PaymentService>(PaymentService);
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

  // ================ 1. 基础：handleNotify 跨表更新顺序 order → task ================
  describe('handleNotify 跨表顺序验证', () => {
    it('✅ 支付成功回调：事务内先 order.update → 再 order.findUnique → 再 task.update → 再钱包流水', async () => {
      prisma = buildOrderTrackingPrisma();
      wxPay = buildWxPayMock({ out_trade_no: '42', trade_state: 'SUCCESS' });
      service = await compileService();

      const res = await service.handleNotify('ts', 'nonce', 'sig', {
        resource: { ciphertext: 'c', nonce: 'n', associated_data: 'a' },
      });

      expect(res.code).toBe('SUCCESS');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const txOps = prisma._txOpRecords[0].ops;

      // 提取跨表主操作（排除钱包内部辅助 findUnique 等）
      const mainOps = txOps.filter((o: any) => o.op === 'order.update' || o.op === 'task.update');
      expect(mainOps.length).toBeGreaterThanOrEqual(2);
      // 关键断言：第一个主操作必须是 order.update，第二个主操作必须是 task.update
      expect(mainOps[0].op).toBe('order.update');
      expect(mainOps[1].op).toBe('task.update');
      expect(mainOps[0].id).toBe(42n);
    });

    it('❌ 支付回调验签失败：不进入任何事务，直接抛 ForbiddenException', async () => {
      prisma = buildOrderTrackingPrisma();
      wxPay = buildWxPayMock();
      wxPay.verifySignature.mockReturnValue(false);
      service = await compileService();

      await expect(
        service.handleNotify('ts', 'nonce', 'bad-sig', {}),
      ).rejects.toThrow(ForbiddenException);

      // 关键：验签失败时不应产生任何 $transaction 或跨表更新
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma._txOpRecords).toHaveLength(0);
    });

    it('回调无 resource：直接返回 SUCCESS，不产生事务', async () => {
      prisma = buildOrderTrackingPrisma();
      wxPay = buildWxPayMock();
      service = await compileService();

      const res = await service.handleNotify('ts', 'nonce', 'sig', {});
      expect(res.code).toBe('SUCCESS');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('trade_state = CLOSED：使用 $transaction 外部的 order.update（单表，无死锁风险）', async () => {
      prisma = buildOrderTrackingPrisma();
      wxPay = buildWxPayMock({ out_trade_no: '99', trade_state: 'CLOSED' });
      service = await compileService();

      const res = await service.handleNotify('ts', 'nonce', 'sig', {
        resource: { ciphertext: 'c', nonce: 'n', associated_data: 'a' },
      });

      expect(res.code).toBe('SUCCESS');
      // CLOSED 走的是外部 prisma.order.update（不涉及 task），不应进入 $transaction
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma._nonTxOps.map((o: any) => o.op)).toContain('prisma.order.update');
    });
  });

  // ================ 2. handleNotify 所有跨表操作包裹在同一事务内 ================
  describe('handleNotify 事务完整性', () => {
    it('支付成功回调：order/task/wallet 所有写入都在同一个 $transaction 内（不是多个独立事务）', async () => {
      prisma = buildOrderTrackingPrisma();
      wxPay = buildWxPayMock({ out_trade_no: '7', trade_state: 'SUCCESS' });
      service = await compileService();

      await service.handleNotify('ts', 'nonce', 'sig', {
        resource: { ciphertext: 'c', nonce: 'n', associated_data: 'a' },
      });

      // 只能有一次 $transaction 调用（跨表 order/task 写入在同一个事务中完成，防止死锁）
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const txOps = prisma._txOpRecords[0].ops;
      // 事务内部必须包含：order.update、task.update（核心的跨表写在同一个事务里按顺序完成）
      const opTypes = txOps.map((o: any) => o.op);
      expect(opTypes).toContain('order.update');
      expect(opTypes).toContain('task.update');

      // 🔑 跨表顺序安全：事务里第一个主写操作一定是 order.update，第二个是 task.update
      const mainWrites = opTypes.filter(
        (t: string) => t === 'order.update' || t === 'task.update',
      );
      expect(mainWrites[0]).toBe('order.update');
      expect(mainWrites[1]).toBe('task.update');

      // 外部裸调用不应出现 order.update / task.update（这两类跨表写必须走事务）
      const externalCrossTableWrites = prisma._nonTxOps.filter(
        (o: any) => o.op === 'prisma.order.update' || o.op === 'prisma.task.update',
      );
      expect(externalCrossTableWrites).toHaveLength(0);
    });
  });

  // ================ 3. 并发多订单回调：每单内部顺序都正确 ================
  describe('并发回调压力下的顺序不变性', () => {
    const N = 30; // 30 笔并发支付回调

    it(`🚀 ${N} 笔并发支付回调，每单事务内 order.update 均早于 task.update`, async () => {
      prisma = buildOrderTrackingPrisma();
      // 让 decryptResource 根据回调顺序给出不同的 out_trade_no
      wxPay = {
        verifySignature: jest.fn().mockReturnValue(true),
        decryptResource: jest.fn(),
        signForFrontend: jest.fn(),
        buildAuthorization: jest.fn(),
      };
      service = await compileService();

      const tasks: Promise<any>[] = [];
      for (let i = 0; i < N; i++) {
        const outTradeNo = (1000 + i).toString();
        wxPay.decryptResource.mockReturnValueOnce({ out_trade_no: outTradeNo, trade_state: 'SUCCESS' });
        tasks.push(
          service.handleNotify(`ts${i}`, `n${i}`, `s${i}`, {
            resource: { ciphertext: 'c', nonce: 'n', associated_data: 'a' },
          }),
        );
      }
      await Promise.all(tasks);

      expect(prisma.$transaction).toHaveBeenCalledTimes(N);
      expect(prisma._txOpRecords).toHaveLength(N);

      // 每一笔事务的主操作顺序都必须是 order.update → task.update
      for (let i = 0; i < N; i++) {
        const record = prisma._txOpRecords[i];
        const mainOps = record.ops.filter(
          (o: any) => o.op === 'order.update' || o.op === 'task.update',
        );
        expect(mainOps.length).toBeGreaterThanOrEqual(2);
        expect(mainOps[0].op).toBe('order.update');
        expect(mainOps[1].op).toBe('task.update');
        const expectedId = 1000n + BigInt(i);
        expect(mainOps[0].id).toBe(expectedId);
      }
    });
  });

  // ================ 4. cancelExpiredOrders 每次迭代独立事务 + 顺序正确 ================
  describe('cancelExpiredOrders 事务与顺序验证', () => {
    it('3 笔超时订单：产生 3 个独立事务，每个事务内 order.update → task.update', async () => {
      prisma = buildOrderTrackingPrisma();
      // 给 prisma.order.findMany 返回 3 笔待取消订单
      prisma.order.findMany.mockResolvedValue([
        { id: 10n, task: { id: 100n, status: 'ASSIGNED' } },
        { id: 20n, task: { id: 200n, status: 'ASSIGNED' } },
        { id: 30n, task: { id: 300n, status: 'ASSIGNED' } },
      ]);
      wxPay = buildWxPayMock();
      service = await compileService();

      const cnt = await service.cancelExpiredOrders();
      expect(cnt).toBe(3);

      // 每个订单一个独立事务
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(prisma._txOpRecords).toHaveLength(3);

      const expectedIds = [10n, 20n, 30n];
      prisma._txOpRecords.forEach((record: any, idx: number) => {
        const mainOps = record.ops.filter(
          (o: any) => o.op === 'order.update' || o.op === 'task.update',
        );
        expect(mainOps.length).toBeGreaterThanOrEqual(2);
        expect(mainOps[0].op).toBe('order.update');
        expect(mainOps[0].id).toBe(expectedIds[idx]);
        expect(mainOps[1].op).toBe('task.update');
      });
    });

    it('订单 task 非 ASSIGNED 时：事务内仍先 order.update，但跳过 task.update（顺序仍安全）', async () => {
      prisma = buildOrderTrackingPrisma();
      prisma.order.findMany.mockResolvedValue([
        { id: 77n, task: { id: 700n, status: 'CANCELLED' } }, // 非 ASSIGNED，不应更新 task
      ]);
      wxPay = buildWxPayMock();
      service = await compileService();

      const cnt = await service.cancelExpiredOrders();
      expect(cnt).toBe(1);

      const ops = prisma._txOpRecords[0].ops;
      const hasOrderUpdate = ops.some((o: any) => o.op === 'order.update' && o.id === 77n);
      const hasTaskUpdate = ops.some((o: any) => o.op === 'task.update');
      expect(hasOrderUpdate).toBe(true);
      expect(hasTaskUpdate).toBe(false); // task 跳过，避免不必要的锁
    });
  });

  // ================ 5. 并发 cancel + notify 混合压力 ================
  describe('混合并发（notify + cancelExpiredOrders）顺序安全', () => {
    it('10 笔 notify + 5 笔 cancel 同时执行：所有事务内部 order 始终先于 task', async () => {
      prisma = buildOrderTrackingPrisma();
      prisma.order.findMany.mockResolvedValue([
        { id: 500n, task: { id: 501n, status: 'ASSIGNED' } },
        { id: 510n, task: { id: 511n, status: 'ASSIGNED' } },
        { id: 520n, task: { id: 521n, status: 'ASSIGNED' } },
        { id: 530n, task: { id: 531n, status: 'ASSIGNED' } },
        { id: 540n, task: { id: 541n, status: 'ASSIGNED' } },
      ]);
      wxPay = {
        verifySignature: jest.fn().mockReturnValue(true),
        decryptResource: jest.fn(),
        signForFrontend: jest.fn(),
        buildAuthorization: jest.fn(),
      };
      service = await compileService();

      const notifyTasks = [];
      for (let i = 0; i < 10; i++) {
        const outTradeNo = (8000 + i).toString();
        wxPay.decryptResource.mockReturnValueOnce({ out_trade_no: outTradeNo, trade_state: 'SUCCESS' });
        notifyTasks.push(
          service.handleNotify(`ts${i}`, `n${i}`, `s${i}`, {
            resource: { ciphertext: 'c', nonce: 'n', associated_data: 'a' },
          }),
        );
      }

      const all: Promise<any>[] = [...notifyTasks, service.cancelExpiredOrders()];
      await Promise.all(all);

      // 10 notify + 5 cancel 订单 = 15 个事务
      expect(prisma.$transaction).toHaveBeenCalledTimes(15);
      expect(prisma._txOpRecords).toHaveLength(15);

      // 每一笔事务的主操作顺序都必须是 order → task（若存在 task.update）
      for (const record of prisma._txOpRecords) {
        const mainOps = record.ops.filter(
          (o: any) => o.op === 'order.update' || o.op === 'task.update',
        );
        if (mainOps.length === 0) continue;
        expect(mainOps[0].op).toBe('order.update');
        const idxTask = mainOps.findIndex((o: any) => o.op === 'task.update');
        if (idxTask !== -1) {
          expect(idxTask).toBeGreaterThan(0); // 有 task.update 时，必然在 order.update 之后
        }
      }
    });
  });
});
