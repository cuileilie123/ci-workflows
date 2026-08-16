import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WxPayUtil } from './wx-pay.util';
import { ProfitSharingService } from '../admin/profit-sharing/profit-sharing.service';
import { FinanceSettingsService } from '../admin/finance-settings/finance-settings.service';
import { MetricsService } from '../../common/metrics.service';
import { Prisma } from '@prisma/client';
import { createTestLogger } from '@neighborhood-help/test-utils';

const log = createTestLogger('payment.service.spec');

/**
 * PaymentService 单元测试（纯 Mock，无需数据库）
 *
 * 覆盖核心逻辑：
 *  1. createOrder  - 创建支付订单（taskId 校验、权限校验、状态校验）
 *  2. queryOrder   - 查询订单（返回 taskId 字段，BUG-06 修复回归）
 *  3. cancelOrder  - 取消待支付订单（BUG-08 修复：前端调用 → 后端实现）
 *  4. refund       - 申请退款（orderId 校验、权限校验、金额校验，BUG-13 修复回归）
 *
 * 重点回归测试：
 *  - BUG-06/07: 订单详情跳转/支付使用 taskId 而非 orderId → queryOrder 必须返回 taskId
 *  - BUG-08:    取消订单功能从"仅前端 Toast"改为真实后端调用
 *  - BUG-13:    退款用 orderId 而非 taskId → refund 必须接收 orderId 参数
 */
describe('PaymentService - 支付/退款/取消核心逻辑', () => {
  let service: PaymentService;
  let prisma: any;
  let wxPay: any;
  let moduleRef: TestingModule | null = null;

  // ---- 测试数据 ----
  const PUBLISHER_ID = 1001n;
  const HELPER_ID = 2001n;
  const TASK_ID = 100n;
  const ORDER_ID = 1n;
  const OTHER_USER_ID = 3001n;

  const defaultTask = {
    id: TASK_ID,
    title: '测试任务',
    status: 'ASSIGNED',
    helperId: HELPER_ID,
    publisherId: PUBLISHER_ID,
    price: new Prisma.Decimal(100),
    address: '北京市朝阳区',
  };

  const defaultOrder = (overrides: Partial<any> = {}) => ({
    id: ORDER_ID,
    orderNo: 'AB12345678',
    taskId: TASK_ID,
    helperId: HELPER_ID,
    totalAmount: new Prisma.Decimal(100),
    platformFee: new Prisma.Decimal(10),
    status: 'PENDING',
    paidAt: null,
    refundAmount: null,
    refundReason: null,
    createdAt: new Date('2026-08-10T10:00:00Z'),
    task: {
      id: TASK_ID,
      title: '测试任务',
      address: '北京市朝阳区',
      publisherId: PUBLISHER_ID,
      status: 'ASSIGNED',
    },
    ...overrides,
  });

  const defaultWallet = {
    id: 1n,
    userId: HELPER_ID,
    balance: new Prisma.Decimal(0),
    frozen: new Prisma.Decimal(0),
  };

  /** 构建 Prisma mock */
  const createPrismaMock = (overrides: Partial<any> = {}) => {
    const txScope = {
      order: {
        update: jest.fn().mockResolvedValue(defaultOrder()),
        findUnique: jest.fn().mockResolvedValue(defaultOrder()),
      },
      task: {
        update: jest.fn().mockResolvedValue({ ...defaultTask, status: 'IN_PROGRESS' }),
      },
    };

    return {
      $transaction: jest.fn().mockImplementation(async (cb: Function) => cb(txScope)),
      task: {
        findUnique: jest.fn().mockResolvedValue(defaultTask),
        ...overrides.task,
      },
      order: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          // 按 orderNo 查询时返回 null（表示订单号不存在，generateUniqueOrderNo 不重试）
          if (where && where.orderNo) return Promise.resolve(null);
          // 按 id 查询时返回默认订单
          return Promise.resolve(defaultOrder());
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(defaultOrder()),
        findMany: jest.fn().mockResolvedValue([]),
        ...overrides.order,
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: PUBLISHER_ID, openid: 'mock_openid' }),
        ...overrides.user,
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(defaultWallet),
        create: jest.fn().mockResolvedValue(defaultWallet),
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides.wallet,
      },
      transaction: {
        create: jest.fn().mockResolvedValue({}),
        ...overrides.transaction,
      },
      _txScope: txScope,
    };
  };

  const createWxPayMock = () => ({
    signForFrontend: jest.fn().mockReturnValue({
      timeStamp: '1234567890',
      nonceStr: 'mock_nonce',
      package: 'prepay_id=wx_mock_prepay',
      signType: 'RSA',
      paySign: 'mock_sign',
    }),
    verifySignature: jest.fn().mockReturnValue(true),
    decryptResource: jest.fn(),
    buildAuthorization: jest.fn(),
    buildProfitSharingBody: jest.fn().mockReturnValue('{}'),
  });

  // ---- 依赖服务 mock（PaymentService 构造函数依赖） ----
  const createProfitSharingMock = () => ({
    calculate: jest.fn().mockResolvedValue({
      platformFee: 10,
      wechatFee: 0.6,
      helperAmount: 89.4,
      ruleId: '1',
      mode: 'FLAT',
      platformRate: 0.1,
      helperRate: 0.9,
    }),
  });

  const createFinanceSettingsMock = () => ({
    getActiveProfitSharingReceiver: jest.fn().mockResolvedValue({
      enabled: false,
      mchId: '',
      name: '平台佣金账户',
    }),
    getActiveMainMchId: jest.fn().mockResolvedValue(''),
    getActiveAppId: jest.fn().mockResolvedValue(''),
    clearMainConfigCache: jest.fn(),
  });

  const createMetricsMock = () => ({
    recordSuccess: jest.fn(),
    recordFail: jest.fn(),
    recordException: jest.fn(),
  });

  const compileService = async (prismaMock?: any, wxPayMock?: any) => {
    prisma = prismaMock || createPrismaMock();
    wxPay = wxPayMock || createWxPayMock();
    moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: WxPayUtil, useValue: wxPay },
        { provide: ProfitSharingService, useValue: createProfitSharingMock() },
        { provide: FinanceSettingsService, useValue: createFinanceSettingsMock() },
        { provide: MetricsService, useValue: createMetricsMock() },
      ],
    }).compile();
    service = moduleRef.get<PaymentService>(PaymentService);
  };

  afterEach(async () => {
    jest.clearAllMocks();
    if (moduleRef) {
      await moduleRef.close();
      moduleRef = null;
    }
  });

  // ===================================================================
  // 1. createOrder - 创建支付订单
  // ===================================================================
  describe('createOrder', () => {
    it('任务为 ASSIGNED 状态且用户为发布者时，应成功创建订单', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(null), // 无已存在订单
            create: jest.fn().mockResolvedValue(defaultOrder()),
          },
        }),
      );
      const result = await service.createOrder(String(PUBLISHER_ID), {
        taskId: String(TASK_ID),
      });

      expect(result).toBeDefined();
      expect(result.orderId).toBe(String(ORDER_ID));
      expect(result.payParams).toHaveProperty('paySign');
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: TASK_ID,
            helperId: HELPER_ID,
            status: 'PENDING',
          }),
        }),
      );
      log('createOrder 成功路径通过');
    });

    it('任务不存在时应抛出 NotFoundException', async () => {
      await compileService(
        createPrismaMock({
          task: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
      );

      await expect(
        service.createOrder(String(PUBLISHER_ID), { taskId: String(TASK_ID) }),
      ).rejects.toThrow(NotFoundException);
      log('createOrder 任务不存在校验通过');
    });

    it('任务状态非 ASSIGNED 时应抛出 ConflictException', async () => {
      await compileService(
        createPrismaMock({
          task: {
            findUnique: jest.fn().mockResolvedValue({ ...defaultTask, status: 'OPEN' }),
          },
        }),
      );

      await expect(
        service.createOrder(String(PUBLISHER_ID), { taskId: String(TASK_ID) }),
      ).rejects.toThrow(ConflictException);
      log('createOrder 状态校验通过');
    });

    it('任务无 helperId 时应抛出 ConflictException', async () => {
      await compileService(
        createPrismaMock({
          task: {
            findUnique: jest.fn().mockResolvedValue({ ...defaultTask, helperId: null }),
          },
        }),
      );

      await expect(
        service.createOrder(String(PUBLISHER_ID), { taskId: String(TASK_ID) }),
      ).rejects.toThrow(ConflictException);
      log('createOrder helperId 校验通过');
    });

    it('非发布者创建订单时应抛出 ForbiddenException', async () => {
      await compileService();

      await expect(
        service.createOrder(String(OTHER_USER_ID), { taskId: String(TASK_ID) }),
      ).rejects.toThrow(ForbiddenException);
      log('createOrder 权限校验通过');
    });

    it('已有未完成订单时应抛出 ConflictException', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findFirst: jest.fn().mockResolvedValue(defaultOrder({ status: 'PENDING' })),
            findUnique: jest.fn().mockImplementation(({ where }: any) => {
              if (where && where.orderNo) return Promise.resolve(null); // orderNo 查询返回 null
              return Promise.resolve(defaultOrder());
            }),
            create: jest.fn().mockResolvedValue(defaultOrder()),
          },
        }),
      );

      await expect(
        service.createOrder(String(PUBLISHER_ID), { taskId: String(TASK_ID) }),
      ).rejects.toThrow(ConflictException);
      log('createOrder 重复订单校验通过');
    });

    it('已有 CANCELLED 订单时应允许重新创建', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockImplementation(({ where }: any) => {
              if (where && where.orderNo) return Promise.resolve(null); // orderNo 查询返回 null
              return Promise.resolve(defaultOrder({ status: 'CANCELLED' }));
            }),
            create: jest.fn().mockResolvedValue(defaultOrder()),
          },
        }),
      );

      const result = await service.createOrder(String(PUBLISHER_ID), {
        taskId: String(TASK_ID),
      });
      expect(result.orderId).toBe(String(ORDER_ID));
      log('createOrder 已取消订单可重建通过');
    });

    it('【BUG-06/07 回归】创建订单时使用 taskId 而非 orderId 关联任务', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(null), // 无已存在订单
            create: jest.fn().mockResolvedValue(defaultOrder()),
          },
        }),
      );
      await service.createOrder(String(PUBLISHER_ID), { taskId: String(TASK_ID) });

      // 验证 order.create 中的 taskId 来自 dto.taskId，不是新生成的 orderId
      const createCall = prisma.order.create.mock.calls[0][0];
      expect(createCall.data.taskId).toBe(TASK_ID);
      expect(createCall.data.taskId).not.toBe(ORDER_ID);
      log('BUG-06/07 回归通过：order.taskId = dto.taskId');
    });
  });

  // ===================================================================
  // 2. queryOrder - 查询订单状态
  // ===================================================================
  describe('queryOrder', () => {
    it('订单存在时应返回完整字段（含 taskId）', async () => {
      await compileService();
      const result = await service.queryOrder(String(ORDER_ID));

      expect(result).toBeDefined();
      expect(result.id).toBe(String(ORDER_ID));
      expect(result.status).toBe('PENDING');
      expect(result.totalAmount).toBe('100');
      expect(result.paidAt).toBeNull();
    });

    it('【BUG-06 回归】返回值必须包含 taskId 字段（供前端跳转任务详情）', async () => {
      await compileService();
      const result = await service.queryOrder(String(ORDER_ID));

      // BUG-06 修复：前端 goToTask 使用 order.taskId 跳转，后端必须返回此字段
      expect(result).toHaveProperty('taskId');
      expect(result.taskId).toBe(String(TASK_ID));
      expect(result.taskId).not.toBe(result.id); // taskId ≠ orderId
      log('BUG-06 回归通过：queryOrder 返回 taskId 且 ≠ orderId');
    });

    it('【BUG-10 回归】返回值应包含 publisherId 和 helperId（供评价页判断角色）', async () => {
      await compileService();
      const result = await service.queryOrder(String(ORDER_ID));

      expect(result).toHaveProperty('publisherId');
      expect(result).toHaveProperty('helperId');
      expect(result.publisherId).toBe(String(PUBLISHER_ID));
      expect(result.helperId).toBe(String(HELPER_ID));
      log('BUG-10 回归通过：queryOrder 返回 publisherId/helperId');
    });

    it('订单不存在时应抛出 NotFoundException', async () => {
      await compileService(
        createPrismaMock({
          order: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
      );

      await expect(service.queryOrder(String(ORDER_ID))).rejects.toThrow(NotFoundException);
    });
  });

  // ===================================================================
  // 3. cancelOrder - 取消待支付订单（BUG-08 修复）
  // ===================================================================
  describe('cancelOrder（BUG-08 修复：取消订单后端实现）', () => {
    it('PENDING 订单 + 发布者 → 应成功取消', async () => {
      await compileService();
      const result = await service.cancelOrder(String(PUBLISHER_ID), String(ORDER_ID));

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      log('cancelOrder 成功路径通过');
    });

    it('订单不存在时应抛出 NotFoundException', async () => {
      await compileService(
        createPrismaMock({
          order: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
      );

      await expect(
        service.cancelOrder(String(PUBLISHER_ID), String(ORDER_ID)),
      ).rejects.toThrow(NotFoundException);
      log('cancelOrder 订单不存在校验通过');
    });

    it('非发布者取消时应抛出 ForbiddenException', async () => {
      await compileService();

      await expect(
        service.cancelOrder(String(OTHER_USER_ID), String(ORDER_ID)),
      ).rejects.toThrow(ForbiddenException);
      log('cancelOrder 权限校验通过');
    });

    it('非 PENDING 状态订单取消时应抛出 ConflictException', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PAID' })),
          },
        }),
      );

      await expect(
        service.cancelOrder(String(PUBLISHER_ID), String(ORDER_ID)),
      ).rejects.toThrow(ConflictException);
      log('cancelOrder 状态校验通过');
    });

    it('取消时应将任务从 ASSIGNED 回滚为 OPEN', async () => {
      await compileService();
      await service.cancelOrder(String(PUBLISHER_ID), String(ORDER_ID));

      // 获取事务回调中调用的 tx 对象
      const txCb = prisma.$transaction.mock.calls[0][0];
      const tx = prisma._txScope;
      await txCb(tx);

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: { status: 'CANCELLED' },
        }),
      );
      expect(tx.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'OPEN', helperId: null }),
        }),
      );
      log('cancelOrder 任务回滚通过');
    });

    it('取消时事务内先更新 order 再更新 task（防 AB-BA 死锁）', async () => {
      await compileService();
      const callOrder: string[] = [];
      prisma._txScope.order.update.mockImplementation(() => {
        callOrder.push('order');
        return Promise.resolve(defaultOrder());
      });
      prisma._txScope.task.update.mockImplementation(() => {
        callOrder.push('task');
        return Promise.resolve(defaultTask);
      });

      await service.cancelOrder(String(PUBLISHER_ID), String(ORDER_ID));

      expect(callOrder[0]).toBe('order');
      expect(callOrder[1]).toBe('task');
      log('cancelOrder 死锁顺序通过：order → task');
    });
  });

  // ===================================================================
  // 4. refund - 申请退款
  // ===================================================================
  describe('refund', () => {
    it('PAID 订单 + 发布者 → 应成功退款', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(
              defaultOrder({
                status: 'PAID',
                paidAt: new Date('2026-08-10T10:05:00Z'),
              }),
            ),
            update: jest.fn().mockResolvedValue(defaultOrder({ status: 'REFUNDED' })),
          },
        }),
      );

      const result = await service.refund(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        amount: 100,
        reason: '用户申请退款',
      });

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('refundId');
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({
            status: 'REFUNDED',
            refundAmount: 100,
          }),
        }),
      );
      log('refund 成功路径通过');
    });

    it('订单不存在时应抛出 NotFoundException', async () => {
      await compileService(
        createPrismaMock({
          order: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
      );

      await expect(
        service.refund(String(PUBLISHER_ID), {
          orderId: String(ORDER_ID),
          amount: 100,
        }),
      ).rejects.toThrow(NotFoundException);
      log('refund 订单不存在校验通过');
    });

    it('非发布者退款时应抛出 ForbiddenException', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PAID' })),
          },
        }),
      );

      await expect(
        service.refund(String(OTHER_USER_ID), {
          orderId: String(ORDER_ID),
          amount: 100,
        }),
      ).rejects.toThrow(ForbiddenException);
      log('refund 权限校验通过');
    });

    it('非 PAID 状态订单退款时应抛出 BadRequestException', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PENDING' })),
          },
        }),
      );

      await expect(
        service.refund(String(PUBLISHER_ID), {
          orderId: String(ORDER_ID),
          amount: 100,
        }),
      ).rejects.toThrow(BadRequestException);
      log('refund 状态校验通过');
    });

    it('退款金额超过订单金额时应抛出 BadRequestException', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PAID' })),
          },
        }),
      );

      await expect(
        service.refund(String(PUBLISHER_ID), {
          orderId: String(ORDER_ID),
          amount: 200, // 订单金额为 100
        }),
      ).rejects.toThrow(BadRequestException);
      log('refund 金额校验通过');
    });

    it('【BUG-13 回归】退款使用 orderId 而非 taskId', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PAID' })),
            update: jest.fn().mockResolvedValue(defaultOrder({ status: 'REFUNDED' })),
          },
        }),
      );

      await service.refund(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        amount: 50,
      });

      // 验证 order.update 使用的是 orderId（1），不是 taskId（100）
      const updateCall = prisma.order.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe(ORDER_ID);
      expect(updateCall.where.id).not.toBe(TASK_ID);
      log('BUG-13 回归通过：refund 使用 orderId = ' + ORDER_ID);
    });

    it('退款成功后应写入 EXPENSE 类型流水', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PAID' })),
            update: jest.fn().mockResolvedValue(defaultOrder({ status: 'REFUNDED' })),
          },
        }),
      );

      await service.refund(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        amount: 80,
      });

      // createTransaction 写入负数金额的 EXPENSE 流水
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'EXPENSE',
            amount: -80,
            orderId: ORDER_ID,
          }),
        }),
      );
      log('refund 流水写入通过');
    });
  });
});
