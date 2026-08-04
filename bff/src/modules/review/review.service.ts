import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SensitiveService } from '../../common/sensitive.service';
import { CreditService } from './credit.service';
import { CreateReviewDto, QueryReviewDto } from './dto/review.dto';

const PAGE_SIZE = 10;

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sensitive: SensitiveService,
    private readonly creditService: CreditService,
  ) {}

  // ============ 1. 提交评价 ============
  async createReview(userId: string, dto: CreateReviewDto) {
    const orderId = BigInt(dto.orderId);
    const reviewerId = BigInt(userId);
    const revieweeId = BigInt(dto.revieweeId);

    // 1. 验证订单存在且已完成
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { task: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'COMPLETED' && order.status !== 'PAID') {
      throw new ConflictException('订单未完成，无法评价');
    }

    // 2. 验证权限：只有发布者或接单者可评价
    const isPublisher = order.task.publisherId === reviewerId;
    const isHelper = order.helperId === reviewerId;
    if (!isPublisher && !isHelper) {
      throw new ForbiddenException('无权限评价此订单');
    }

    // 3. 不能评价自己
    if (reviewerId === revieweeId) {
      throw new ForbiddenException('不能评价自己');
    }

    // 4. 检查是否已评价（每人每单只能评一次）
    const existing = await this.prisma.review.findFirst({
      where: { orderId, reviewerId },
    });
    if (existing) throw new ConflictException('您已评价过此订单');

    // 5. 敏感词过滤
    const filteredComment = this.sensitive.filter(dto.comment);

    // 6. 创建评价
    const review = await this.prisma.review.create({
      data: {
        orderId,
        reviewerId,
        revieweeId,
        rating: dto.rating,
        tags: (dto.tags ??
          []) as unknown as import('@prisma/client/runtime/library').InputJsonValue,
        comment: filteredComment,
      },
    });

    // 7. 更新被评价者信用分
    await this.creditService.updateCredit(String(revieweeId));

    this.logger.log(`评价创建: orderId=${orderId}, reviewer=${userId}, rating=${dto.rating}`);

    return review;
  }

  // ============ 2. 查看订单评价 ============
  async getOrderReview(orderId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { orderId: BigInt(orderId) },
      include: {
        reviewer: { select: { id: true, nickname: true, avatar: true } },
        reviewee: { select: { id: true, nickname: true, avatar: true } },
      },
    });

    return reviews.map((r) => ({
      id: r.id.toString(),
      rating: r.rating,
      tags: r.tags as string[],
      comment: r.comment,
      createdAt: r.createdAt,
      reviewer: {
        id: r.reviewer.id.toString(),
        nickname: r.reviewer.nickname,
        avatar: r.reviewer.avatar,
      },
      reviewee: {
        id: r.reviewee.id.toString(),
        nickname: r.reviewee.nickname,
        avatar: r.reviewee.avatar,
      },
    }));
  }

  // ============ 3. 用户全部评价 ============
  async getUserReviews(userId: string, query: QueryReviewDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? PAGE_SIZE;
    const skip = (page - 1) * limit;

    const where = { revieweeId: BigInt(userId) };

    const [total, reviews] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({
        where,
        include: {
          reviewer: { select: { id: true, nickname: true, avatar: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      list: reviews.map((r) => ({
        id: r.id.toString(),
        orderId: r.orderId.toString(),
        rating: r.rating,
        tags: r.tags as string[],
        comment: r.comment,
        createdAt: r.createdAt,
        reviewer: {
          id: r.reviewer.id.toString(),
          nickname: r.reviewer.nickname,
          avatar: r.reviewer.avatar,
        },
      })),
      page,
      hasMore: page * limit < total,
      total,
    };
  }

  // ============ 4. 用户信用分详情 ============
  async getCredit(userId: string) {
    return this.creditService.getCreditDetail(userId);
  }
}
