---
name: review-credit
description: 实现评价系统 + 信用分自动计算
model: claude-4-sonnet
tags: [bff, review, risk]
depends_on: [nestjs-init, payment-gateway]
---

# 任务：实现评价 + 信用分体系

## 目标
订单完成后双方互评，信用分自动计算，低分用户受限。

## 具体步骤

### 1. 创建 `src/modules/review/review.controller.ts`

**接口清单：**
| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/reviews` | 提交评价 |
| GET  | `/api/v1/reviews/:orderId` | 查看订单评价 |
| GET  | `/api/v1/users/:id/reviews` | 用户全部评价 |
| GET  | `/api/v1/users/:id/credit` | 用户信用分详情 |

### 2. 评价提交逻辑
```typescript
@Post()
@UseGuards(JwtAuthGuard)
async createReview(@Body() dto: CreateReviewDto, @Req() req) {
  // 1. 验证订单已完成
  const order = await this.prisma.order.findUnique({
    where: { id: dto.orderId },
    include: { task: true }
  });
  if (order.status !== 'COMPLETED') throw new ConflictException('订单未完成');
  if (order.task.publisherId !== req.user.sub && order.helperId !== req.user.sub) {
    throw new ForbiddenException('无权限评价此订单');
  }
  
  // 2. 检查是否已评价（双向评价，每人一次）
  const existing = await this.prisma.review.findFirst({
    where: { orderId: dto.orderId, reviewerId: req.user.sub }
  });
  if (existing) throw new ConflictException('已评价过');
  
  // 3. 敏感词过滤
  dto.comment = this.sensitiveFilter.filter(dto.comment);
  
  // 4. 创建评价
  const review = await this.prisma.review.create({
    data: {
      orderId: dto.orderId,
      reviewerId: req.user.sub,
      revieweeId: dto.revieweeId,
      rating: dto.rating,    // 1-5
      tags: dto.tags,         // ['准时','态度好','专业']
      comment: dto.comment
    }
  });
  
  // 5. 异步更新信用分
  await this.creditService.updateCredit(dto.revieweeId);
  
  return review;
}
```

### 3. 信用分计算服务 `credit.service.ts`
```typescript
@Injectable()
export class CreditService {
  // 初始分 100，范围 0-200
  
  async updateCredit(userId: number): Promise<number> {
    const reviews = await this.prisma.review.findMany({
      where: { revieweeId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50  // 最近50条
    });
    
    if (reviews.length === 0) return 100;
    
    // 加权平均（近期权重高）
    let totalWeight = 0;
    let weightedSum = 0;
    reviews.forEach((r, idx) => {
      const weight = 1 / (idx + 1);  // 越近权重越高
      weightedSum += r.rating * weight;
      totalWeight += weight;
    });
    const avgRating = weightedSum / totalWeight;
    
    // 映射到 0-200 区间（3星=100，5星=200，1星=0）
    const baseScore = ((avgRating - 1) / 4) * 100 + 100;
    
    // 加分项
    let bonus = 0;
    const completedCount = await this.getCompletedCount(userId);
    if (completedCount > 10) bonus += 10;
    if (completedCount > 50) bonus += 20;
    
    // 减分项（从 orders 表统计投诉/取消）
    const cancelCount = await this.getCancelCount(userId);
    bonus -= cancelCount * 5;
    
    const finalScore = Math.max(0, Math.min(200, Math.round(baseScore + bonus)));
    
    // 更新用户信用分
    await this.prisma.user.update({
      where: { id: userId },
      data: { creditScore: finalScore }
    });
    
    // 低分告警
    if (finalScore < 60) {
      this.eventEmitter.emit('user.low_credit', { userId, score: finalScore });
    }
    
    return finalScore;
  }
  
  // 信用分对应的权益
  getPrivileges(score: number) {
    if (score >= 150) return ['优先推荐', '免押金', '专属客服'];
    if (score >= 100) return ['正常接单', '信用评级良'];
    if (score >= 60)  return ['限制大额订单'];
    return ['禁止接单', '仅可发单'];
  }
}
```

### 4. 评价标签枚举
```typescript
const REVIEW_TAGS = {
  POSITIVE: ['准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'],
  NEGATIVE: ['迟到爽约', '态度恶劣', '质量差', '沟通困难', '虚假描述']
};
```

### 5. 前端评价组件 `components/review-form/index.vue`
- 五星评分（支持半星）
- 标签快捷选择（最多选 3 个）
- 文字评价（max 200 字）
- 提交前敏感词前端预检

### 6. 用户主页 `pages/user/profile.vue`
- 展示信用分（环形进度条，0-200）
- 信用等级：⭐⭐⭐ 优秀 / ⭐⭐ 良好 / ⭐ 一般 / ⚠️ 受限
- 评价列表（分页，按时间倒序）
- 评价统计：均分、各星占比

## 验收标准
- [ ] 订单完成后可评价
- [ ] 每人每单只能评一次
- [ ] 敏感词被过滤
- [ ] 信用分自动计算正确
- [ ] 信用分 < 60 不能接单
- [ ] 评价列表展示正确
- [ ] 标签统计正确
- [ ] 低分用户告警触发

## 参考文件
- `specs/02-task.md` → 任务状态机（COMPLETED 才允许评价）
- `specs/05-risk.md` → 信用分体系
- `.trae/memory.md` → 禁止事项
