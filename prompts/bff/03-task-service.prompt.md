---
name: task-service
description: 实现任务 CRUD + 附近搜索 + 接单逻辑
model: claude-4-sonnet
tags: [bff, task]
depends_on: [nestjs-init, wx-login-gateway]
---

# 任务：实现任务服务

## 目标
完成任务的发布、列表、详情、接单、状态变更等核心接口。

## 具体步骤

### 1. 创建 `src/modules/task/task.controller.ts`

**接口清单：**
| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/tasks` | 发布任务 |
| GET  | `/api/v1/tasks` | 附近任务列表 |
| GET  | `/api/v1/tasks/:id` | 任务详情 |
| PUT  | `/api/v1/tasks/:id` | 更新任务（仅发布者） |
| DELETE | `/api/v1/tasks/:id` | 取消任务（仅发布者） |
| POST | `/api/v1/tasks/:id/accept` | 接单 |
| POST | `/api/v1/tasks/:id/start` | 开始服务 |
| POST | `/api/v1/tasks/:id/complete` | 确认完成 |
| GET  | `/api/v1/tasks/search` | 关键词搜索 |

### 2. 发布任务
```typescript
@Post()
@UseGuards(JwtAuthGuard)
async createTask(@Body() dto: CreateTaskDto, @Req() req) {
  // 1. 敏感内容检测
  await this.wxService.msgSecCheck(dto.title + dto.description);
  
  // 2. 图片安全检测（异步）
  dto.images.forEach(img => this.wxService.imgSecCheck(img));
  
  // 3. 计算 GeoHash
  const geohash = geohash.encode(dto.lat, dto.lng, 7);
  
  // 4. 创建任务
  return this.prisma.task.create({
    data: {
      publisherId: req.user.sub,
      title: dto.title,
      description: dto.description,
      price: dto.price,
      lat: dto.lat,
      lng: dto.lng,
      geohash,
      images: dto.images,
      category: dto.category,
      expireAt: dto.expireAt || new Date(Date.now() + 24 * 3600 * 1000)
    }
  });
}
```

### 3. 附近任务列表（GeoHash 算法）
```typescript
@Get()
async listNearby(
  @Query('lng') lng: number,
  @Query('lat') lat: number,
  @Query('page') page = 1,
  @Query('category') category?: string
) {
  // 1. 计算中心 GeoHash (精度7 ≈ 150m)
  const centerHash = geohash.encode(lat, lng, 7);
  
  // 2. 获取 8 个邻居 + 中心 = 9 个区域
  const neighbors = geohash.neighbors(centerHash);
  const hashes = [centerHash, ...neighbors];
  
  // 3. Redis 缓存
  const cacheKey = `nearby:${centerHash}:${page}:${category || 'all'}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  // 4. 数据库查询
  const tasks = await this.prisma.task.findMany({
    where: {
      geohash: { in: hashes },
      status: 'OPEN',
      expireAt: { gt: new Date() },
      ...(category && { category })
    },
    include: { publisher: { select: { nickname: true, avatar: true } } },
    skip: (page - 1) * 20,
    take: 20,
    orderBy: { createdAt: 'desc' }
  });
  
  // 5. 计算距离 + 缓存
  const result = tasks.map(t => ({
    ...t,
    distance: this.calcDistance(lat, lng, t.lat, t.lng)
  }));
  await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
  
  return result;
}
```

### 4. 接单逻辑（分布式锁）
```typescript
@Post(':id/accept')
@UseGuards(JwtAuthGuard)
async acceptTask(@Param('id') taskId: number, @Req() req) {
  const userId = req.user.sub;
  const lockKey = `task:lock:${taskId}`;
  
  // 1. 获取分布式锁（SETNX，TTL=10s）
  const locked = await this.redis.set(lockKey, userId, 'NX', 'EX', 10);
  if (!locked) throw new ConflictException('任务正在被接单，请稍后重试');
  
  try {
    // 2. 检查任务状态
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (task.status !== 'OPEN') throw new ConflictException('任务已被接单');
    if (task.publisherId === userId) throw new ForbiddenException('不能接自己的任务');
    
    // 3. 检查信用分
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user.creditScore < 60) throw new ForbiddenException('信用分不足，无法接单');
    
    // 4. 更新状态
    return this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'ASSIGNED', helperId: userId }
    });
  } finally {
    // 5. 释放锁
    await this.redis.del(lockKey);
  }
}
```

### 5. 搜索接口（Elasticsearch）
- 调用 ES `tasks` 索引
- 多字段匹配：title^3, description, location
- 支持分页 + 高亮

## 验收标准
- [ ] 发布任务含敏感词被拦截
- [ ] 附近列表按距离排序正确
- [ ] 缓存命中率 > 80%
- [ ] 并发接单只有一个成功
- [ ] 信用分不足不能接单
- [ ] 搜索结果高亮关键词

## 参考文件
- `specs/02-task.md` → 全部章节
- `.trae/memory.md` → ADR-003 GeoHash + 已知坑
