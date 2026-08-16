import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfitSharingService, WECHAT_CHANNEL_RATE } from './profit-sharing.service';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrisma = {
  profitSharingRule: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

describe('ProfitSharingService (分账规则)', () => {
  let service: ProfitSharingService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfitSharingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ProfitSharingService);
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T12:00:00Z'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => jest.useRealTimers());

  describe('create - FLAT 模式', () => {
    it('should create a FLAT rule successfully', async () => {
      const saved = {
        id: 1n, name: '全局默认', categoryId: null,
        mode: 'FLAT', platformRate: 0.1, helperRate: 0.894,
        tiers: null,
        minPlatformFee: null, maxPlatformFee: null,
        isActive: true, validFrom: null, validTo: null,
        priority: 0, createdAt: new Date(), updatedAt: new Date(),
      };
      mockPrisma.profitSharingRule.create.mockResolvedValue(saved);
      const result = await service.create(
        { name: '全局默认', mode: 'FLAT', platformRate: 0.1, priority: 0 },
        '1',
        '127.0.0.1',
      );
      expect(result.id).toBe('1');
      expect(result.platformRate).toBe(0.1);
      expect(mockPrisma.profitSharingRule.create).toHaveBeenCalledTimes(1);
    });

    it('should create FLAT rule with min/max platform fee', async () => {
      mockPrisma.profitSharingRule.create.mockResolvedValue({
        id: 2n, name: '跑腿保底', categoryId: 1n,
        mode: 'FLAT', platformRate: 0.05, helperRate: 0.944,
        tiers: null,
        minPlatformFee: 5, maxPlatformFee: 50,
        isActive: true, validFrom: null, validTo: null,
        priority: 5, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.create({
        name: '跑腿保底', categoryId: '1', mode: 'FLAT',
        platformRate: 0.05, minPlatformFee: 5, maxPlatformFee: 50, priority: 5,
      }, '1');
      expect(result.minPlatformFee).toBe(5);
      expect(result.maxPlatformFee).toBe(50);
    });

    it('should reject maxPlatformFee < minPlatformFee', async () => {
      await expect(
        service.create({
          name: '错误范围', categoryId: '1', mode: 'FLAT',
          platformRate: 0.1, minPlatformFee: 20, maxPlatformFee: 10,
        }, '1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create - TIERED 模式', () => {
    it('should create a TIERED rule successfully', async () => {
      mockPrisma.profitSharingRule.create.mockResolvedValue({
        id: 3n, name: '分段抽佣', categoryId: null,
        mode: 'TIERED', platformRate: 0.05, helperRate: 0.944,
        tiers: [{ rangeStart: 0, rangeEnd: null, platformRate: 0.05 }],
        minPlatformFee: null, maxPlatformFee: null,
        isActive: true, validFrom: null, validTo: null,
        priority: 0, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.create({
        name: '分段抽佣', mode: 'TIERED',
        tiers: [{ rangeStart: 0, rangeEnd: null, platformRate: 0.05 }],
      }, '1');
      expect(result.mode).toBe('TIERED');
      expect(result.tiers).toHaveLength(1);
    });

    it('should reject TIERED with empty tiers', async () => {
      await expect(
        service.create({ name: '空分段', mode: 'TIERED', tiers: [] }, '1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject TIERED where first tier rangeStart != 0', async () => {
      await expect(
        service.create({
          name: '错误起始', mode: 'TIERED',
          tiers: [{ rangeStart: 10, rangeEnd: null, platformRate: 0.05 }],
        }, '1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject TIERED with non-contiguous ranges', async () => {
      await expect(
        service.create({
          name: '不连续', mode: 'TIERED',
          tiers: [
            { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
            { rangeStart: 200, rangeEnd: null, platformRate: 0.1 },
          ],
        }, '1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('calculate - FLAT 模式', () => {
    it('should use DEFAULT rule when no rule matches', async () => {
      mockPrisma.profitSharingRule.findFirst.mockResolvedValue(null);
      const result = await service.calculate(100);
      expect(result.ruleId).toBe('DEFAULT');
      expect(result.platformFee).toBe(10);
      // helperAmount = 100 - 10 - 0.6 = 89.4
      expect(result.helperAmount).toBe(89.4);
      expect(result.wechatFee).toBe(0.6);
    });

    it('should apply minPlatformFee when calculated fee is lower', async () => {
      mockPrisma.profitSharingRule.findFirst
        .mockResolvedValueOnce({
          id: 5n, mode: 'FLAT', platformRate: 0.05, helperRate: 0.944,
          minPlatformFee: 5, maxPlatformFee: null, tiers: null,
        })
        .mockResolvedValue(null as never);
      // 30 * 5% = 1.5 → min 5
      const r = await service.calculate(30, '2');
      expect(r.platformFee).toBe(5);
      // helperAmount = 30 - 5 - 0.18 = 24.82
      expect(r.helperAmount).toBe(24.82);
    });

    it('should apply maxPlatformFee when calculated fee is higher', async () => {
      mockPrisma.profitSharingRule.findFirst
        .mockResolvedValueOnce({
          id: 6n, mode: 'FLAT', platformRate: 0.15, helperRate: 0.844,
          minPlatformFee: null, maxPlatformFee: 20, tiers: null,
        })
        .mockResolvedValue(null as never);
      // 500 * 15% = 75 → max 20
      const r = await service.calculate(500, '3');
      expect(r.platformFee).toBe(20);
      // helperAmount = 500 - 20 - 3 = 477
      expect(r.helperAmount).toBe(477);
    });
  });

  describe('calculate - TIERED 模式', () => {
    it('should calculate tiered fee like income tax', async () => {
      mockPrisma.profitSharingRule.findFirst
        .mockResolvedValueOnce({
          id: 7n, mode: 'TIERED', platformRate: 0.05, helperRate: 0.944,
          minPlatformFee: null, maxPlatformFee: null,
          tiers: [
            { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
            { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
            { rangeStart: 500, rangeEnd: null, platformRate: 0.1 },
          ],
        })
        .mockResolvedValue(null as never);

      // 800元 → 100*5% + 400*8% + 300*10% = 5 + 32 + 30 = 67
      const r = await service.calculate(800, '4');
      expect(r.platformFee).toBe(67);
      // wechatFee = 800 * 0.006 = 4.8
      expect(r.wechatFee).toBe(4.8);
      // helperAmount = 800 - 67 - 4.8 = 728.2
      expect(r.helperAmount).toBe(728.2);
      expect(r.mode).toBe('TIERED');
    });

    it('should calculate correctly when amount falls in first tier only', async () => {
      mockPrisma.profitSharingRule.findFirst
        .mockResolvedValueOnce({
          id: 8n, mode: 'TIERED', platformRate: 0.05, helperRate: 0.944,
          minPlatformFee: null, maxPlatformFee: null,
          tiers: [
            { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
            { rangeStart: 100, rangeEnd: null, platformRate: 0.1 },
          ],
        })
        .mockResolvedValue(null as never);

      // 50元 → 50*5% = 2.5
      const r = await service.calculate(50, '5');
      expect(r.platformFee).toBe(2.5);
      // helperAmount = 50 - 2.5 - 0.3 = 47.2
      expect(r.helperAmount).toBe(47.2);
    });
  });

  describe('findOne / remove', () => {
    it('findOne should throw NotFoundException when missing', async () => {
      mockPrisma.profitSharingRule.findUnique.mockResolvedValue(null);
      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });

    it('remove should delete and write audit log', async () => {
      mockPrisma.profitSharingRule.findUnique.mockResolvedValue({
        id: 1n, name: 'Test',
      });
      mockPrisma.profitSharingRule.delete.mockResolvedValue({});
      const r = await service.remove('1', 'admin-1', '::1');
      expect(r.success).toBe(true);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'DELETE' }),
        }),
      );
    });
  });
});
