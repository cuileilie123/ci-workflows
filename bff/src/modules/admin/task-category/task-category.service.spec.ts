import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TaskCategoryService } from './task-category.service';
import { PrismaService } from '../../../prisma/prisma.service';

const mockPrisma = {
  taskCategory: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  task: {
    count: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

describe('TaskCategoryService (任务类别管理)', () => {
  let service: TaskCategoryService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskCategoryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(TaskCategoryService);
  });

  beforeEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('should throw ConflictException when code exists', async () => {
      mockPrisma.taskCategory.findUnique.mockResolvedValue({
        id: 1n, code: 'DELIVERY', name: '跑腿送货',
      });
      await expect(
        service.create({ code: 'DELIVERY', name: '跑腿' }, '1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.taskCategory.create).not.toHaveBeenCalled();
    });

    it('should create successfully with valid payload', async () => {
      mockPrisma.taskCategory.findUnique.mockResolvedValue(null);
      mockPrisma.taskCategory.create.mockResolvedValue({
        id: 2n, code: 'CLEANING', name: '家政保洁',
        icon: null, sort: 0, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      });
      const cat = await service.create(
        { code: 'CLEANING', name: '家政保洁', sort: 0 },
        'admin-id',
        '10.0.0.1',
      );
      expect(cat.code).toBe('CLEANING');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'CREATE', targetType: 'TASK_CATEGORY' }),
        }),
      );
    });
  });

  describe('findAll / findOne / findByCode', () => {
    it('findAll should filter by isActive by default', async () => {
      mockPrisma.taskCategory.findMany.mockResolvedValue([]);
      await service.findAll();
      expect(mockPrisma.taskCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('findAll with includeInactive=true should return all', async () => {
      await service.findAll(true);
      expect(mockPrisma.taskCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('findOne should throw NotFoundException when missing', async () => {
      mockPrisma.taskCategory.findUnique.mockResolvedValue(null);
      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update / remove', () => {
    it('should update and log audit', async () => {
      mockPrisma.taskCategory.findUnique.mockResolvedValue({
        id: 1n, code: 'REPAIR',
      });
      mockPrisma.taskCategory.update.mockResolvedValue({
        id: 1n, code: 'REPAIR', name: '家电维修',
      });
      await service.update('1', { name: '家电维修' }, 'admin');
      expect(mockPrisma.taskCategory.update).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'UPDATE' }),
        }),
      );
    });

    it('remove should throw Conflict when tasks exist under category', async () => {
      mockPrisma.taskCategory.findUnique.mockResolvedValue({ id: 7n });
      mockPrisma.task.count.mockResolvedValue(3);
      await expect(service.remove('7')).rejects.toThrow(ConflictException);
      expect(mockPrisma.taskCategory.delete).not.toHaveBeenCalled();
    });

    it('remove should delete when no tasks and write audit DELETE', async () => {
      mockPrisma.taskCategory.findUnique.mockResolvedValue({ id: 7n, code: 'MOVING', name: '搬家' });
      mockPrisma.task.count.mockResolvedValue(0);
      mockPrisma.taskCategory.delete.mockResolvedValue({});
      await service.remove('7', 'admin-1');
      expect(mockPrisma.taskCategory.delete).toHaveBeenCalledWith({ where: { id: 7n } });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'DELETE' }),
        }),
      );
    });
  });
});
