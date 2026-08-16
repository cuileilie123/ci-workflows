import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { Prisma, TaskCategory } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTaskCategoryDto } from './dto/create-task-category.dto';
import { UpdateTaskCategoryDto } from './dto/update-task-category.dto';

@Injectable()
export class TaskCategoryService {
  private readonly logger = new Logger(TaskCategoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async writeAuditLog(
    adminId: string | undefined,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    targetId: bigint,
    detail: unknown,
    ip: string | undefined,
  ): Promise<void> {
    try {
      let adminBigInt: bigint | null = null;
      if (adminId) {
        try {
          adminBigInt = BigInt(adminId);
        } catch {
          adminBigInt = null;
        }
      }
      await this.prisma.auditLog.create({
        data: {
          adminId: adminBigInt,
          action,
          targetType: 'TASK_CATEGORY',
          targetId,
          detail: (detail ?? {}) as Prisma.InputJsonValue,
          ip: ip ?? '127.0.0.1',
        },
      });
    } catch (err) {
      this.logger.warn(`写入审计日志失败: ${(err as Error).message}`);
    }
  }

  async create(dto: CreateTaskCategoryDto, adminId?: string, ip?: string): Promise<TaskCategory> {
    const existing = await this.prisma.taskCategory.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException('类别编码已存在');
    }

    const category = await this.prisma.taskCategory.create({
      data: {
        code: dto.code,
        name: dto.name,
        icon: dto.icon ?? null,
        sort: dto.sort ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.writeAuditLog(adminId, 'CREATE', category.id, dto, ip);
    return category;
  }

  async findAll(includeInactive = false): Promise<TaskCategory[]> {
    return this.prisma.taskCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { sort: 'asc' },
    });
  }

  async findOne(id: string): Promise<TaskCategory> {
    const category = await this.prisma.taskCategory.findUnique({
      where: { id: BigInt(id) },
    });
    if (!category) {
      throw new NotFoundException('任务类别不存在');
    }
    return category;
  }

  async findByCode(code: string): Promise<TaskCategory | null> {
    return this.prisma.taskCategory.findUnique({
      where: { code },
    });
  }

  async update(
    id: string,
    dto: UpdateTaskCategoryDto,
    adminId?: string,
    ip?: string,
  ): Promise<TaskCategory> {
    const categoryId = BigInt(id);
    const existing = await this.prisma.taskCategory.findUnique({
      where: { id: categoryId },
    });
    if (!existing) {
      throw new NotFoundException('任务类别不存在');
    }

    const updateData: Prisma.TaskCategoryUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.sort !== undefined) updateData.sort = dto.sort;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    const updated = await this.prisma.taskCategory.update({
      where: { id: categoryId },
      data: updateData,
    });

    await this.writeAuditLog(adminId, 'UPDATE', categoryId, dto, ip);
    return updated;
  }

  async remove(id: string, adminId?: string, ip?: string): Promise<void> {
    const categoryId = BigInt(id);
    const existing = await this.prisma.taskCategory.findUnique({
      where: { id: categoryId },
    });
    if (!existing) {
      throw new NotFoundException('任务类别不存在');
    }

    const taskCount = await this.prisma.task.count({
      where: { categoryId },
    });
    if (taskCount > 0) {
      throw new ConflictException('该类别下存在任务，无法删除');
    }

    await this.prisma.taskCategory.delete({
      where: { id: categoryId },
    });

    await this.writeAuditLog(
      adminId,
      'DELETE',
      categoryId,
      { code: existing.code, name: existing.name },
      ip,
    );
  }
}
