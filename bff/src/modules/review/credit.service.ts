import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_CREDIT = 200;
const MIN_CREDIT = 0;
const RECENT_REVIEWS_LIMIT = 50;

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 更新用户信用分
   * 算法：最近 50 条评价加权平均 → 映射到 0-200 → 加减分项
   */
  async updateCredit(userId: string): Promise<number> {
    const uid = BigInt(userId);

    // 1. 获取最近评价
    const reviews = await this.prisma.review.findMany({
      where: { revieweeId: uid },
      orderBy: { createdAt: 'desc' },
      take: RECENT_REVIEWS_LIMIT,
    });

    if (reviews.length === 0) {
      return 100; // 初始分
    }

    // 2. 加权平均（越近权重越高）
    let totalWeight = 0;
    let weightedSum = 0;
    reviews.forEach((r, idx) => {
      const weight = 1 / (idx + 1);
      weightedSum += r.rating * weight;
      totalWeight += weight;
    });
    const avgRating = weightedSum / totalWeight;

    // 3. 映射到 0-200 区间（3星=100, 5星=200, 1星=0）
    const baseScore = ((avgRating - 1) / 4) * 100 + 100;

    // 4. 加分项（完成任务数量）
    let bonus = 0;
    const completedCount = await this.getCompletedCount(uid);
    if (completedCount > 10) bonus += 10;
    if (completedCount > 50) bonus += 20;

    // 5. 减分项（取消订单数）
    const cancelCount = await this.getCancelCount(uid);
    bonus -= cancelCount * 5;

    // 6. 最终分数
    const finalScore = Math.max(MIN_CREDIT, Math.min(MAX_CREDIT, Math.round(baseScore + bonus)));

    // 7. 更新用户
    await this.prisma.user.update({
      where: { id: uid },
      data: { creditScore: finalScore },
    });

    this.logger.log(`信用分更新: userId=${userId}, score=${finalScore}, reviews=${reviews.length}`);

    return finalScore;
  }

  /**
   * 获取信用分详情
   */
  async getCreditDetail(userId: string): Promise<{
    score: number;
    level: string;
    totalReviews: number;
    avgRating: number;
    distribution: Record<number, number>;
    completedCount: number;
  }> {
    const uid = BigInt(userId);

    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    const reviews = await this.prisma.review.findMany({
      where: { revieweeId: uid },
    });

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;
    for (const r of reviews) {
      distribution[r.rating] = (distribution[r.rating] || 0) + 1;
      totalRating += r.rating;
    }

    return {
      score: user?.creditScore ?? 100,
      level: this.getLevelLabel(user?.creditScore ?? 100),
      totalReviews: reviews.length,
      avgRating: reviews.length > 0 ? Number((totalRating / reviews.length).toFixed(1)) : 0,
      distribution,
      completedCount: await this.getCompletedCount(uid),
    };
  }

  /** 获取完成的订单数 */
  private async getCompletedCount(userId: bigint): Promise<number> {
    const count = await this.prisma.order.count({
      where: {
        OR: [
          { helperId: userId, status: 'COMPLETED' },
          { task: { publisherId: userId }, status: 'COMPLETED' },
        ],
      },
    });
    return count;
  }

  /** 获取取消的订单数 */
  private async getCancelCount(userId: bigint): Promise<number> {
    const count = await this.prisma.order.count({
      where: {
        status: 'CANCELLED',
        OR: [{ helperId: userId }],
      },
    });
    return count;
  }

  /** 等级标签 */
  private getLevelLabel(score: number): string {
    if (score >= 150) return '优秀';
    if (score >= 100) return '良好';
    if (score >= 60) return '一般';
    return '受限';
  }
}
