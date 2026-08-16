import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ReviewService } from './review.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SensitiveService } from '../../common/sensitive.service';
import { CreditService } from './credit.service';
import { Prisma } from '@prisma/client';
import { createTestLogger } from '@neighborhood-help/test-utils';

const log = createTestLogger('review.service.spec');

/**
 * ReviewService 单元测试（纯 Mock，无需数据库）
 *
 * 覆盖核心逻辑：
 *  1. createReview     - 创建评价（权限校验、自我评价拦截、重复评价拦截、敏感词过滤）
 *  2. getOrderReview   - 查看订单评价（含 reviewer/reviewee 信息）
 *  3. getUserReviews   - 用户全部评价（分页）
 *
 * 重点回归测试：
 *  - BUG-10: 评价页被评价者 ID 使用订单 ID → 后端必须校验 revieweeId 合法性
 *  - BUG-33: 评价创建页强制要求文字评价 → 后端 DTO 中 comment 为可选（测试空 comment）
 */
describe('ReviewService - 评价核心逻辑', () => {
  let service: ReviewService;
  let prisma: any;
  let sensitive: any;
  let creditService: any;
  let moduleRef: TestingModule | null = null;

  // ---- 测试数据 ----
  const PUBLISHER_ID = 1001n;
  const HELPER_ID = 2001n;
  const ORDER_ID = 1n;
  const TASK_ID = 100n;
  const REVIEW_ID = 500n;
  const OTHER_USER_ID = 3001n;

  const defaultTask = {
    id: TASK_ID,
    title: '测试任务',
    publisherId: PUBLISHER_ID,
    helperId: HELPER_ID,
    status: 'IN_PROGRESS',
    price: new Prisma.Decimal(100),
  };

  const defaultOrder = (overrides: Partial<any> = {}) => ({
    id: ORDER_ID,
    taskId: TASK_ID,
    helperId: HELPER_ID,
    totalAmount: new Prisma.Decimal(100),
    status: 'COMPLETED',
    task: defaultTask,
    ...overrides,
  });

  const defaultReview = (overrides: Partial<any> = {}) => ({
    id: REVIEW_ID,
    orderId: ORDER_ID,
    reviewerId: PUBLISHER_ID,
    revieweeId: HELPER_ID,
    rating: 5,
    tags: ['准时到达', '态度友善'],
    comment: '非常满意',
    createdAt: new Date('2026-08-10T12:00:00Z'),
    reviewer: {
      id: PUBLISHER_ID,
      nickname: '发布者',
      avatar: 'https://example.com/avatar1.png',
    },
    reviewee: {
      id: HELPER_ID,
      nickname: '帮助者',
      avatar: 'https://example.com/avatar2.png',
    },
    ...overrides,
  });

  /** 构建 Prisma mock */
  const createPrismaMock = (overrides: Partial<any> = {}) => ({
    order: {
      findUnique: jest.fn().mockResolvedValue(defaultOrder()),
      ...overrides.order,
    },
    review: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([defaultReview()]),
      create: jest.fn().mockImplementation((args: any) => ({
        ...defaultReview(),
        ...args.data,
      })),
      count: jest.fn().mockResolvedValue(1),
      ...overrides.review,
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: HELPER_ID, creditScore: 100 }),
      update: jest.fn().mockResolvedValue(undefined),
      ...overrides.user,
    },
  });

  const createSensitiveMock = () => ({
    filter: jest.fn().mockImplementation((text: string) => text),
  });

  const createCreditServiceMock = () => ({
    updateCredit: jest.fn().mockResolvedValue(120),
    getCreditDetail: jest.fn().mockResolvedValue({
      score: 120,
      level: '良好',
      totalReviews: 1,
      avgRating: 5,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      completedCount: 0,
    }),
  });

  const compileService = async (prismaMock?: any) => {
    prisma = prismaMock || createPrismaMock();
    sensitive = createSensitiveMock();
    creditService = createCreditServiceMock();
    moduleRef = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: PrismaService, useValue: prisma },
        { provide: SensitiveService, useValue: sensitive },
        { provide: CreditService, useValue: creditService },
      ],
    }).compile();
    service = moduleRef.get<ReviewService>(ReviewService);
  };

  afterEach(async () => {
    jest.clearAllMocks();
    if (moduleRef) {
      await moduleRef.close();
      moduleRef = null;
    }
  });

  // ===================================================================
  // 1. createReview - 创建评价
  // ===================================================================
  describe('createReview', () => {
    it('发布者评价帮助者：COMPLETED 订单 + 合法 revieweeId → 应成功创建', async () => {
      await compileService();
      const result = await service.createReview(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        revieweeId: String(HELPER_ID),
        rating: 5,
        tags: ['准时到达'],
        comment: '非常满意',
      });

      expect(result).toBeDefined();
      expect(result.rating).toBe(5);
      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: ORDER_ID,
            reviewerId: PUBLISHER_ID,
            revieweeId: HELPER_ID,
            rating: 5,
          }),
        }),
      );
      log('createReview 发布者评价帮助者通过');
    });

    it('帮助者评价发布者：COMPLETED 订单 + 合法 revieweeId → 应成功创建', async () => {
      await compileService();
      const result = await service.createReview(String(HELPER_ID), {
        orderId: String(ORDER_ID),
        revieweeId: String(PUBLISHER_ID),
        rating: 4,
        comment: '沟通顺畅',
      });

      expect(result).toBeDefined();
      expect(result.rating).toBe(4);
      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewerId: HELPER_ID,
            revieweeId: PUBLISHER_ID,
          }),
        }),
      );
      log('createReview 帮助者评价发布者通过');
    });

    it('PAID 状态订单也可评价（业务允许 PAID/COMPLETED 评价）', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PAID' })),
          },
        }),
      );

      const result = await service.createReview(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        revieweeId: String(HELPER_ID),
        rating: 5,
      });

      expect(result).toBeDefined();
      log('createReview PAID 订单评价通过');
    });

    it('订单不存在时应抛出 NotFoundException', async () => {
      await compileService(
        createPrismaMock({
          order: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
      );

      await expect(
        service.createReview(String(PUBLISHER_ID), {
          orderId: String(ORDER_ID),
          revieweeId: String(HELPER_ID),
          rating: 5,
        }),
      ).rejects.toThrow(NotFoundException);
      log('createReview 订单不存在校验通过');
    });

    it('订单未完成（PENDING）时应抛出 ConflictException', async () => {
      await compileService(
        createPrismaMock({
          order: {
            findUnique: jest.fn().mockResolvedValue(defaultOrder({ status: 'PENDING' })),
          },
        }),
      );

      await expect(
        service.createReview(String(PUBLISHER_ID), {
          orderId: String(ORDER_ID),
          revieweeId: String(HELPER_ID),
          rating: 5,
        }),
      ).rejects.toThrow(ConflictException);
      log('createReview 订单状态校验通过');
    });

    it('非订单参与方评价时应抛出 ForbiddenException', async () => {
      await compileService();

      await expect(
        service.createReview(String(OTHER_USER_ID), {
          orderId: String(ORDER_ID),
          revieweeId: String(HELPER_ID),
          rating: 5,
        }),
      ).rejects.toThrow(ForbiddenException);
      log('createReview 权限校验通过');
    });

    it('【BUG-10 回归】评价自己时应抛出 ForbiddenException', async () => {
      // BUG-10 修复：前端曾用 orderId 当 revieweeId，导致评价到错误用户
      // 后端必须有"不能评价自己"的兜底校验
      await compileService();

      await expect(
        service.createReview(String(PUBLISHER_ID), {
          orderId: String(ORDER_ID),
          revieweeId: String(PUBLISHER_ID), // 评价自己
          rating: 5,
        }),
      ).rejects.toThrow(ForbiddenException);
      log('BUG-10 回归通过：不能评价自己');
    });

    it('已评价过该订单时应抛出 ConflictException', async () => {
      await compileService(
        createPrismaMock({
          review: {
            findFirst: jest.fn().mockResolvedValue(defaultReview()), // 已存在评价
          },
        }),
      );

      await expect(
        service.createReview(String(PUBLISHER_ID), {
          orderId: String(ORDER_ID),
          revieweeId: String(HELPER_ID),
          rating: 5,
        }),
      ).rejects.toThrow(ConflictException);
      log('createReview 重复评价校验通过');
    });

    it('【BUG-33 回归】comment 为空时也应允许提交（后端 DTO comment 可选）', async () => {
      // BUG-33 修复：前端移除了强制文字评价检查，后端应接受空 comment
      await compileService();
      const result = await service.createReview(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        revieweeId: String(HELPER_ID),
        rating: 4,
        // 不传 comment
      });

      expect(result).toBeDefined();
      expect(result.rating).toBe(4);
      log('BUG-33 回归通过：空 comment 可提交');
    });

    it('评价内容应经过敏感词过滤', async () => {
      await compileService();
      sensitive.filter.mockReturnValue('***过滤后内容***');

      await service.createReview(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        revieweeId: String(HELPER_ID),
        rating: 3,
        comment: '原始敏感内容',
      });

      expect(sensitive.filter).toHaveBeenCalledWith('原始敏感内容');
      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            comment: '***过滤后内容***',
          }),
        }),
      );
      log('createReview 敏感词过滤通过');
    });

    it('评价创建后应触发信用分更新', async () => {
      await compileService();
      await service.createReview(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        revieweeId: String(HELPER_ID),
        rating: 5,
      });

      expect(creditService.updateCredit).toHaveBeenCalledWith(String(HELPER_ID));
      log('createReview 信用分更新触发通过');
    });

    it('评价 tags 为空数组时也应接受', async () => {
      await compileService();
      const result = await service.createReview(String(PUBLISHER_ID), {
        orderId: String(ORDER_ID),
        revieweeId: String(HELPER_ID),
        rating: 3,
        tags: [],
      });

      expect(result).toBeDefined();
      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: [] }),
        }),
      );
      log('createReview 空 tags 通过');
    });
  });

  // ===================================================================
  // 2. getOrderReview - 查看订单评价
  // ===================================================================
  describe('getOrderReview', () => {
    it('应返回订单关联的评价列表（含 reviewer/reviewee 信息）', async () => {
      await compileService();
      const result = await service.getOrderReview(String(ORDER_ID));

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('rating');
      expect(result[0].reviewer).toHaveProperty('nickname');
      expect(result[0].reviewee).toHaveProperty('nickname');
      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: ORDER_ID },
        }),
      );
      log('getOrderReview 正常路径通过');
    });

    it('订单无评价时应返回空数组', async () => {
      await compileService(
        createPrismaMock({
          review: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );
      const result = await service.getOrderReview(String(ORDER_ID));

      expect(result).toEqual([]);
      log('getOrderReview 空结果通过');
    });

    it('返回的 id 应为字符串（非 BigInt）', async () => {
      await compileService();
      const result = await service.getOrderReview(String(ORDER_ID));

      expect(typeof result[0].id).toBe('string');
      expect(typeof result[0].reviewer.id).toBe('string');
      expect(typeof result[0].reviewee.id).toBe('string');
      log('getOrderReview 类型转换通过');
    });
  });

  // ===================================================================
  // 3. getUserReviews - 用户全部评价（分页）
  // ===================================================================
  describe('getUserReviews', () => {
    it('应返回分页评价列表', async () => {
      await compileService();
      const result = await service.getUserReviews(String(HELPER_ID), { page: 1 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page', 1);
      expect(result).toHaveProperty('hasMore');
      expect(Array.isArray(result.list)).toBe(true);
      log('getUserReviews 分页通过');
    });

    it('第二页应正确计算 skip', async () => {
      await compileService();
      await service.getUserReviews(String(HELPER_ID), { page: 2, limit: 10 });

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10, // (2-1) * 10
          take: 10,
        }),
      );
      log('getUserReviews 分页 skip 通过');
    });

    it('未传 page/limit 时应使用默认值', async () => {
      await compileService();
      await service.getUserReviews(String(HELPER_ID));

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0, // (1-1) * 10
          take: 10, // 默认 PAGE_SIZE
        }),
      );
      log('getUserReviews 默认分页通过');
    });

    it('hasMore 在结果不足一页时应为 false', async () => {
      await compileService(
        createPrismaMock({
          review: {
            count: jest.fn().mockResolvedValue(5),
            findMany: jest.fn().mockResolvedValue([defaultReview()]),
          },
        }),
      );

      const result = await service.getUserReviews(String(HELPER_ID), { page: 1, limit: 10 });
      // total=5, page=1, limit=10 → 1*10 < 5 = false
      expect(result.hasMore).toBe(false);
      log('getUserReviews hasMore=false 通过');
    });

    it('hasMore 在还有更多数据时应为 true', async () => {
      await compileService(
        createPrismaMock({
          review: {
            count: jest.fn().mockResolvedValue(25),
            findMany: jest.fn().mockResolvedValue([defaultReview()]),
          },
        }),
      );

      const result = await service.getUserReviews(String(HELPER_ID), { page: 1, limit: 10 });
      // total=25, page=1, limit=10 → 1*10 < 25 = true
      expect(result.hasMore).toBe(true);
      log('getUserReviews hasMore=true 通过');
    });

    it('应只查询 revieweeId = userId 的评价（作为被评价者）', async () => {
      await compileService();
      await service.getUserReviews(String(HELPER_ID));

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { revieweeId: HELPER_ID },
        }),
      );
      expect(prisma.review.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { revieweeId: HELPER_ID },
        }),
      );
      log('getUserReviews 被评价者筛选通过');
    });
  });
});
