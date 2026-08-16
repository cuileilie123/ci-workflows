import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Task, TaskStatus } from '@prisma/client';
import * as ngeohash from 'ngeohash';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SensitiveService } from '../../common/sensitive.service';
import { EsService } from '../search/es.service';
import { VerificationService } from '../verification/verification.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { generateUniqueOrderNo } from '../payment/order-no.util';

const PAGE_SIZE = 20;
const GEOHASH_PRECISION = 7; // ≈150m
const NEARBY_CACHE_TTL = 60; // 秒
const ACCEPT_LOCK_TTL = 10; // 秒
const DEFAULT_EXPIRE_HOURS = 24;

/** 列表项（带距离） */
export interface TaskListItem {
  id: string;
  title: string;
  price: Prisma.Decimal;
  categoryId: bigint;
  category?: { id: string; code: string; name: string; icon: string | null };
  status: TaskStatus;
  address: string;
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  images: unknown;
  distance?: number; // 米（附近列表有，搜索无）
  createdAt: Date;
  expireAt: Date;
  publisher: { nickname: string; avatar: string | null };
}

export interface TaskListResult {
  list: TaskListItem[];
  page: number;
  hasMore: boolean;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sensitive: SensitiveService,
    private readonly esService: EsService,
    private readonly verification: VerificationService,
  ) {}

  // ============ 1. 发布任务 ============
  async create(userId: string, dto: CreateTaskDto): Promise<Task> {
    // 前置校验：须完成手机号绑定、银行卡绑定、实名认证
    await this.verification.requireVerified(BigInt(userId));

    // 敏感内容检测（title + description）
    this.sensitive.checkAndThrow(dto.title, '标题');
    this.sensitive.checkAndThrow(dto.description, '描述');

    const categoryId = BigInt(dto.categoryId);
    // 校验类别存在且启用
    const category = await this.prisma.taskCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) throw new BadRequestException('任务类别不存在');
    if (!category.isActive) throw new BadRequestException('任务类别已禁用');

    const geohash = ngeohash.encode(dto.lat, dto.lng, GEOHASH_PRECISION);
    const expireAt = dto.expireAt
      ? new Date(dto.expireAt)
      : new Date(Date.now() + DEFAULT_EXPIRE_HOURS * 3600 * 1000);

    if (expireAt <= new Date()) {
      throw new BadRequestException('截止时间必须晚于当前时间');
    }

    const task = await this.prisma.task.create({
      data: {
        publisherId: BigInt(userId),
        title: dto.title,
        description: dto.description,
        price: dto.price,
        lat: dto.lat,
        lng: dto.lng,
        geohash,
        address: dto.address,
        categoryId,
        urgency: dto.urgency ?? 'NORMAL',
        images: (dto.images ?? []) as unknown as Prisma.InputJsonValue,
        expireAt,
      },
    });

    // 异步同步到 ES（不阻塞主流程）
    this.esService.indexTask(task).catch((err) => {
      this.logger.error(`ES sync failed: ${err.message}`);
    });

    return task;
  }

  // ============ 2. 附近任务列表 ============
  async listNearby(query: QueryTaskDto): Promise<TaskListResult> {
    if (query.lat === undefined || query.lng === undefined) {
      throw new BadRequestException('缺少 lat/lng 参数');
    }
    const page = query.page ?? 1;

    // 1. 中心 GeoHash + 8 邻居 = 9 区域
    const centerHash = ngeohash.encode(query.lat, query.lng, GEOHASH_PRECISION);
    const hashes = [centerHash, ...ngeohash.neighbors(centerHash)];

    // 2. Redis 缓存
    const cacheKey = `nearby:${centerHash}:${page}:${query.categoryId ?? 'all'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as TaskListResult;
      } catch {
        // 缓存损坏，忽略
      }
    }

    // 3. 数据库查询
    const where: Prisma.TaskWhereInput = {
      geohash: { in: hashes },
      status: 'OPEN',
      expireAt: { gt: new Date() },
      deletedAt: null,
      ...(query.categoryId ? { categoryId: BigInt(query.categoryId) } : {}),
    };

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: {
          publisher: { select: { nickname: true, avatar: true } },
          category: { select: { id: true, code: true, name: true, icon: true } },
        },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // 4. 计算距离 + 按距离排序
    const list: TaskListItem[] = tasks
      .map((t) => ({
        id: t.id.toString(),
        title: t.title,
        price: t.price,
        categoryId: t.categoryId,
        category: t.category
          ? {
              id: t.category.id.toString(),
              code: t.category.code,
              name: t.category.name,
              icon: t.category.icon,
            }
          : undefined,
        status: t.status,
        address: t.address,
        urgency: t.urgency || 'NORMAL',
        images: t.images,
        distance: this.calcDistance(query.lat!, query.lng!, Number(t.lat), Number(t.lng)),
        createdAt: t.createdAt,
        expireAt: t.expireAt,
        publisher: t.publisher,
      }))
      .sort((a, b) => a.distance - b.distance);

    const result: TaskListResult = {
      list,
      page,
      hasMore: page * PAGE_SIZE < total,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), NEARBY_CACHE_TTL);
    return result;
  }

  // ============ 3. 任务详情 ============
  async findOne(
    id: string,
  ): Promise<Task & { publisher: { nickname: string; avatar: string | null } }> {
    const task = await this.prisma.task.findUnique({
      where: { id: BigInt(id) },
      include: { publisher: { select: { nickname: true, avatar: true } } },
    });
    if (!task || task.deletedAt) {
      throw new NotFoundException('任务不存在');
    }

    // 浏览量 +1（非关键，失败忽略）
    this.prisma.task
      .update({ where: { id: BigInt(id) }, data: { viewCount: { increment: 1 } } })
      .catch((err) => this.logger.warn(`浏览量自增失败: ${(err as Error).message}`));

    return task;
  }

  // ============ 3b. 我的发布任务列表 ============
  async myTasks(
    userId: string,
    options: { status?: string; page?: number },
  ): Promise<TaskListResult> {
    const page = options.page ?? 1;

    const where: Prisma.TaskWhereInput = {
      publisherId: BigInt(userId),
      deletedAt: null,
      ...(options.status ? { status: options.status as TaskStatus } : {}),
    };

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: {
          publisher: { select: { nickname: true, avatar: true } },
          category: { select: { id: true, code: true, name: true, icon: true } },
        },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const list: TaskListItem[] = tasks.map((t) => ({
      id: t.id.toString(),
      title: t.title,
      price: t.price,
      categoryId: t.categoryId,
      category: t.category
        ? {
            id: t.category.id.toString(),
            code: t.category.code,
            name: t.category.name,
            icon: t.category.icon,
          }
        : undefined,
      status: t.status,
      address: t.address,
      urgency: t.urgency || 'NORMAL',
      images: t.images,
      createdAt: t.createdAt,
      expireAt: t.expireAt,
      publisher: t.publisher,
    }));

    return {
      list,
      page,
      hasMore: page * PAGE_SIZE < total,
    };
  }

  // ============ 4. 更新任务（仅发布者，仅 OPEN） ============
  async update(userId: string, id: string, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.getOwnedTask(userId, id);
    if (task.status !== 'OPEN') {
      throw new BadRequestException('仅待接单(OPEN)状态的任务可修改');
    }

    if (dto.title) this.sensitive.checkAndThrow(dto.title, '标题');
    if (dto.description) this.sensitive.checkAndThrow(dto.description, '描述');

    // lat/lng 不在更新 DTO 里（OmitType 已排除）；其余字段直接透传
    const updatedTask = await this.prisma.task.update({
      where: { id: BigInt(id) },
      data: dto as Prisma.TaskUpdateInput,
    });

    // 同步到 ES
    this.esService.updateTask(Number(id), dto as Partial<Task>).catch((err: Error) => {
      this.logger.error(`ES update sync failed: ${err.message}`);
    });

    return updatedTask;
  }

  // ============ 5. 取消任务（仅发布者） ============
  async cancel(
    userId: string,
    id: string,
  ): Promise<Task & { hasPaidOrder: boolean; orderId?: string }> {
    const task = await this.getOwnedTask(userId, id);
    if (!['OPEN', 'ASSIGNED', 'EXPIRED'].includes(task.status)) {
      throw new BadRequestException('当前状态不可取消');
    }

    // 检查是否有关联的已支付订单
    const paidOrder = await this.prisma.order.findFirst({
      where: {
        taskId: BigInt(id),
        isSupplement: false,
        status: { in: ['PAID', 'IN_PROGRESS'] },
      },
      select: { id: true },
    });

    const cancelledTask = await this.prisma.task.update({
      where: { id: BigInt(id) },
      data: { status: 'CANCELLED' },
    });

    // 同步到 ES
    this.esService.updateTask(Number(id), { status: 'CANCELLED' }).catch((err) => {
      this.logger.error(`ES cancel sync failed: ${err.message}`);
    });

    return {
      ...cancelledTask,
      hasPaidOrder: !!paidOrder,
      orderId: paidOrder?.id.toString(),
    };
  }

  // ============ 6. 报价接单（分布式锁 + DB 条件更新） ============
  async accept(userId: string, id: string): Promise<Task> {
    // 前置校验：须完成手机号绑定、银行卡绑定、实名认证
    await this.verification.requireVerified(BigInt(userId));

    const taskId = BigInt(id);
    const uid = BigInt(userId);
    const lockKey = `task:lock:${id}`;

    const lockHandle = await this.redis.acquireLock(lockKey, userId, ACCEPT_LOCK_TTL, {
      context: `报价接单 taskId=${id}, userId=${userId}`,
      alertThresholdMs: ACCEPT_LOCK_TTL * 1000 * 3,
    });
    if (this.redis.isAvailable() && !lockHandle) {
      throw new ConflictException('任务正在被报价，请稍后重试');
    }

    try {
      const task = await this.prisma.task.findUnique({ where: { id: taskId } });
      if (!task || task.deletedAt) {
        throw new NotFoundException('任务不存在');
      }
      if (task.status !== 'OPEN') {
        throw new ConflictException('任务已被接单');
      }
      if (task.publisherId === uid) {
        throw new ForbiddenException('不能接自己的任务');
      }

      const user = await this.prisma.user.findUnique({ where: { id: uid } });
      if (!user) throw new NotFoundException('用户不存在');
      if (user.creditScore < 60) {
        throw new ForbiddenException('信用分不足，无法接单');
      }

      // 检查是否已有BIDDING订单（同一接单人不能重复报价）
      const existingBidding = await this.prisma.order.findFirst({
        where: {
          taskId,
          helperId: uid,
          status: 'BIDDING',
        },
      });
      if (existingBidding) {
        throw new ConflictException('您已对该任务报价，请等待发布者确认');
      }

      // 创建BIDDING状态订单，报价24小时后自动过期
      const quoteExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const totalAmount = task.price ?? 0;
      const platformFee = totalAmount.times(0.06);

      const orderNo = await generateUniqueOrderNo(async (no) => {
        const existing = await this.prisma.order.findUnique({ where: { orderNo: no } });
        return !!existing;
      });
      await this.prisma.order.create({
        data: {
          orderNo,
          taskId,
          helperId: uid,
          totalAmount,
          platformFee,
          status: 'BIDDING',
          isSupplement: false,
          quoteExpiresAt,
        },
      });

      // 任务状态保持OPEN（多人可同时报价）
      return task;
    } finally {
      if (lockHandle) {
        await lockHandle.release();
      } else {
        await this.redis.del(lockKey);
      }
    }
  }

  // ============ 6b. 发布者确认接单人 ============
  async confirmBid(userId: string, taskIdStr: string, orderIdStr: string): Promise<Task> {
    const taskId = BigInt(taskIdStr);
    const orderId = BigInt(orderIdStr);
    const uid = BigInt(userId);

    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.deletedAt) {
      throw new NotFoundException('任务不存在');
    }
    if (task.publisherId !== uid) {
      throw new ForbiddenException('只有任务发布者可确认接单人');
    }
    if (task.status !== 'OPEN') {
      throw new ConflictException('任务状态不允许确认接单人');
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'BIDDING') {
      throw new ConflictException('该报价不可确认');
    }
    if (order.taskId !== taskId) {
      throw new BadRequestException('订单与任务不匹配');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. 将确认的订单变为PENDING（待支付）
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'PENDING', quoteExpiresAt: null },
      });

      // 2. 拒绝该任务下其他BIDDING订单
      await tx.order.updateMany({
        where: {
          taskId,
          status: 'BIDDING',
          id: { not: orderId },
        },
        data: {
          rejectedAt: new Date(),
          rejectReason: '客户选择了其他接单人',
        },
      });

      // 3. 更新任务状态为ASSIGNED
      await tx.task.update({
        where: { id: taskId },
        data: { status: 'ASSIGNED', helperId: order.helperId },
      });

      const updated = await tx.task.findUnique({ where: { id: taskId } });
      return updated!;
    });
  }

  // ============ 6c. 发布者拒绝某个报价 ============
  async rejectBid(userId: string, taskIdStr: string, orderIdStr: string): Promise<void> {
    const taskId = BigInt(taskIdStr);
    const orderId = BigInt(orderIdStr);
    const uid = BigInt(userId);

    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.publisherId !== uid) {
      throw new ForbiddenException('无权操作');
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'BIDDING') {
      throw new ConflictException('该报价不可操作');
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        rejectedAt: new Date(),
        rejectReason: '发布者拒绝',
      },
    });
  }

  // ============ 7. 开始服务（接单者） ============
  async start(userId: string, id: string): Promise<Task> {
    const task = await this.getHelperTask(userId, id);
    if (task.status !== 'ASSIGNED') {
      throw new BadRequestException('仅已接单(ASSIGNED)状态可开始服务');
    }
    return this.prisma.task.update({
      where: { id: BigInt(id) },
      data: { status: 'IN_PROGRESS' },
    });
  }

  // ============ 8. 确认完成（发布者） ============
  async complete(userId: string, id: string): Promise<Task> {
    const task = await this.getOwnedTask(userId, id);
    if (task.status !== 'IN_PROGRESS') {
      throw new BadRequestException('仅进行中(IN_PROGRESS)状态可确认完成');
    }
    const completedTask = await this.prisma.task.update({
      where: { id: BigInt(id) },
      data: { status: 'COMPLETED' },
    });

    // 同步到 ES
    this.esService.updateTask(Number(id), { status: 'COMPLETED' }).catch((err) => {
      this.logger.error(`ES complete sync failed: ${err.message}`);
    });

    return completedTask;
  }

  // ============ 9. 关键词搜索 ============
  async search(q: string, page = 1): Promise<TaskListResult & { total: number }> {
    const kw = (q ?? '').trim();
    if (!kw) {
      throw new BadRequestException('搜索关键词不能为空');
    }

    const where: Prisma.TaskWhereInput = {
      status: 'OPEN',
      expireAt: { gt: new Date() },
      deletedAt: null,
      OR: [
        { title: { contains: kw } },
        { description: { contains: kw } },
        { address: { contains: kw } },
      ],
    };

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: {
          publisher: { select: { nickname: true, avatar: true } },
          category: { select: { id: true, code: true, name: true, icon: true } },
        },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const list = tasks.map((t) => ({
      id: t.id.toString(),
      title: this.highlight(t.title, kw),
      price: t.price,
      categoryId: t.categoryId,
      category: t.category
        ? {
            id: t.category.id.toString(),
            code: t.category.code,
            name: t.category.name,
            icon: t.category.icon,
          }
        : undefined,
      status: t.status,
      address: this.highlight(t.address, kw),
      urgency: t.urgency || 'NORMAL',
      images: t.images,
      createdAt: t.createdAt,
      expireAt: t.expireAt,
      publisher: t.publisher,
    }));

    return {
      list,
      page,
      hasMore: page * PAGE_SIZE < total,
      total,
    };
  }

  // ============ 私有辅助 ============

  /** 取得发布者拥有的任务 */
  private async getOwnedTask(userId: string, id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id: BigInt(id) } });
    if (!task || task.deletedAt) {
      throw new NotFoundException('任务不存在');
    }
    if (task.publisherId !== BigInt(userId)) {
      throw new ForbiddenException('无权操作他人任务');
    }
    return task;
  }

  /** 取得接单者承接的任务 */
  private async getHelperTask(userId: string, id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id: BigInt(id) } });
    if (!task || task.deletedAt) {
      throw new NotFoundException('任务不存在');
    }
    if (task.helperId !== BigInt(userId)) {
      throw new ForbiddenException('仅接单者可操作');
    }
    return task;
  }

  /** Haversine 距离（米） */
  private calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }

  /** 关键词高亮（HTML <em>） */
  private highlight(text: string, q: string): string {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'gi'), (m) => `<em>${m}</em>`);
  }

  // ============ 定时清理：过期BIDDING报价（每分钟执行） ============
  @Cron(CronExpression.EVERY_MINUTE)
  async expireBiddingOrders(): Promise<number> {
    const now = new Date();

    // 1. 过期未被确认的BIDDING报价（超过24小时）
    const expiredResult = await this.prisma.order.updateMany({
      where: {
        status: 'BIDDING',
        quoteExpiresAt: { lte: now },
      },
      data: {
        status: 'CANCELLED',
        rejectReason: '报价超时，已自动取消',
      },
    });

    if (expiredResult.count > 0) {
      this.logger.log(`[CRON] 清理过期BIDDING报价: ${expiredResult.count}条已超时取消`);
    }

    // 2. 被拒绝超过24小时的报价 → 标记为CANCELLED
    const rejectedResult = await this.prisma.order.updateMany({
      where: {
        status: 'BIDDING',
        rejectedAt: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      data: { status: 'CANCELLED' },
    });

    if (rejectedResult.count > 0) {
      this.logger.log(`[CRON] 清理被拒绝报价: ${rejectedResult.count}条已过期`);
    }

    return expiredResult.count + rejectedResult.count;
  }
}
