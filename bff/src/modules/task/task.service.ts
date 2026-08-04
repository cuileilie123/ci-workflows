import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Task, TaskCategory, TaskStatus } from '@prisma/client';
import * as ngeohash from 'ngeohash';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SensitiveService } from '../../common/sensitive.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';

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
  category: TaskCategory;
  status: TaskStatus;
  address: string;
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
  ) {}

  // ============ 1. 发布任务 ============
  async create(userId: string, dto: CreateTaskDto): Promise<Task> {
    // 敏感内容检测（title + description）
    this.sensitive.checkAndThrow(dto.title, '标题');
    this.sensitive.checkAndThrow(dto.description, '描述');

    const geohash = ngeohash.encode(dto.lat, dto.lng, GEOHASH_PRECISION);
    const expireAt = dto.expireAt
      ? new Date(dto.expireAt)
      : new Date(Date.now() + DEFAULT_EXPIRE_HOURS * 3600 * 1000);

    if (expireAt <= new Date()) {
      throw new BadRequestException('截止时间必须晚于当前时间');
    }

    return this.prisma.task.create({
      data: {
        publisherId: BigInt(userId),
        title: dto.title,
        description: dto.description,
        price: dto.price,
        lat: dto.lat,
        lng: dto.lng,
        geohash,
        address: dto.address,
        category: dto.category,
        images: (dto.images ?? []) as unknown as Prisma.InputJsonValue,
        expireAt,
      },
    });
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
    const cacheKey = `nearby:${centerHash}:${page}:${query.category ?? 'all'}`;
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
      ...(query.category ? { category: query.category } : {}),
    };

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: {
          publisher: { select: { nickname: true, avatar: true } },
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
        category: t.category,
        status: t.status,
        address: t.address,
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

  // ============ 4. 更新任务（仅发布者，仅 OPEN） ============
  async update(userId: string, id: string, dto: UpdateTaskDto): Promise<Task> {
    const task = await this.getOwnedTask(userId, id);
    if (task.status !== 'OPEN') {
      throw new BadRequestException('仅待接单(OPEN)状态的任务可修改');
    }

    if (dto.title) this.sensitive.checkAndThrow(dto.title, '标题');
    if (dto.description) this.sensitive.checkAndThrow(dto.description, '描述');

    // lat/lng 不在更新 DTO 里（OmitType 已排除）；其余字段直接透传
    return this.prisma.task.update({
      where: { id: BigInt(id) },
      data: dto as Prisma.TaskUpdateInput,
    });
  }

  // ============ 5. 取消任务（仅发布者） ============
  async cancel(userId: string, id: string): Promise<Task> {
    const task = await this.getOwnedTask(userId, id);
    if (!['OPEN', 'ASSIGNED'].includes(task.status)) {
      throw new BadRequestException('当前状态不可取消');
    }
    return this.prisma.task.update({
      where: { id: BigInt(id) },
      data: { status: 'CANCELLED' },
    });
  }

  // ============ 6. 接单（分布式锁 + DB 条件更新） ============
  async accept(userId: string, id: string): Promise<Task> {
    const taskId = BigInt(id);
    const uid = BigInt(userId);
    const lockKey = `task:lock:${id}`;

    // 1. Redis 分布式锁（防惊群）；Redis 不可用时跳过，依赖 DB 条件更新兜底
    const locked = await this.redis.setNx(lockKey, userId, ACCEPT_LOCK_TTL);
    if (this.redis.isAvailable() && !locked) {
      throw new ConflictException('任务正在被接单，请稍后重试');
    }

    try {
      // 2. 前置校验
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

      // 3. DB 条件更新（原子操作，并发只有一个成功）
      const result = await this.prisma.task.updateMany({
        where: { id: taskId, status: 'OPEN' },
        data: { status: 'ASSIGNED', helperId: uid },
      });
      if (result.count === 0) {
        throw new ConflictException('任务已被接单');
      }

      return (await this.prisma.task.findUnique({ where: { id: taskId } }))!;
    } finally {
      await this.redis.del(lockKey);
    }
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
    return this.prisma.task.update({
      where: { id: BigInt(id) },
      data: { status: 'COMPLETED' },
    });
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
        include: { publisher: { select: { nickname: true, avatar: true } } },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const list = tasks.map((t) => ({
      id: t.id.toString(),
      title: this.highlight(t.title, kw),
      price: t.price,
      category: t.category,
      status: t.status,
      address: this.highlight(t.address, kw),
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
}
