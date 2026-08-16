/**
 * 信用分复合索引性能测试（大数据量版）
 * 使用原始 SQL 绕过唯一约束
 * 运行方式: npx ts-node prisma/test-index-performance-large.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 开始信用分复合索引性能测试（大数据量版）\n');

  // 1. 生成大量模拟数据
  console.log('📊 步骤 1: 生成大量模拟测试数据...');
  await seedLargeTestData();
  
  // 2. 检查数据量
  console.log('\n📊 步骤 2: 检查数据量...');
  await checkDataVolume();

  // 3. 性能测试
  console.log('\n⚡ 步骤 3: 执行性能测试...');
  await performanceTests();

  console.log('\n✅ 测试完成！');
}

async function seedLargeTestData() {
  console.log('  使用 SQL 批量生成模拟订单...');
  
  // 使用 INSERT IGNORE 跳过重复的 task_id
  const sql = `
    INSERT IGNORE INTO orders (task_id, helper_id, total_amount, platform_fee, status, created_at, updated_at)
    SELECT 
      t.id,
      FLOOR(1 + RAND() * 200) AS helper_id,
      ROUND(50 + RAND() * 450, 2) AS total_amount,
      ROUND((50 + RAND() * 450) * 0.1, 2) AS platform_fee,
      ELT(FLOOR(1 + RAND() * 6), 'PENDING', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED') AS status,
      DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 730) DAY) AS created_at,
      NOW() AS updated_at
    FROM tasks t;
  `;
  
  await prisma.$executeRawUnsafe(sql);
  console.log('  ✅ 订单生成完成');

  console.log('  生成模拟评价...');
  const reviewSql = `
    INSERT IGNORE INTO reviews (order_id, reviewer_id, reviewee_id, rating, tags, comment, created_at)
    SELECT 
      o.id,
      (o.helper_id % 200) + 1 AS reviewer_id,
      o.helper_id AS reviewee_id,
      FLOOR(1 + RAND() * 5) AS rating,
      JSON_ARRAY(
        ELT(FLOOR(1 + RAND() * 5), '准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'),
        ELT(FLOOR(1 + RAND() * 5), '准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅')
      ) AS tags,
      CONCAT('模拟评价内容', FLOOR(RAND() * 10000)) AS comment,
      DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 730) DAY) AS created_at
    FROM orders o
    WHERE o.status = 'COMPLETED';
  `;
  
  await prisma.$executeRawUnsafe(reviewSql);
  console.log('  ✅ 评价生成完成');
}

async function checkDataVolume() {
  const orderCount = await prisma.order.count();
  const reviewCount = await prisma.review.count();
  
  console.log(`  📦 orders 表: ${orderCount.toLocaleString()} 条记录`);
  console.log(`  📦 reviews 表: ${reviewCount.toLocaleString()} 条记录`);
  
  // 检查数据分布
  const statusDistribution = await prisma.order.groupBy({
    by: ['status'],
    _count: true,
  });
  console.log('\n  订单状态分布:');
  for (const item of statusDistribution) {
    console.log(`    ${item.status}: ${item._count}`);
  }
}

async function performanceTests() {
  const iterations = 100;

  // 查找有数据的用户ID
  const ordersWithHelper = await prisma.order.findFirst({
    where: { helperId: { gt: 0 } },
    select: { helperId: true },
  });
  
  if (!ordersWithHelper) {
    console.log('⚠️ 没有找到订单数据，跳过性能测试');
    return;
  }
  
  const testUserId = ordersWithHelper.helperId;
  console.log(`\n  测试用户 ID: ${testUserId}`);
  
  const userReviewCount = await prisma.review.count({ where: { revieweeId: testUserId } });
  const userCompletedOrders = await prisma.order.count({ 
    where: { helperId: testUserId, status: 'COMPLETED' } 
  });
  const userCancelledOrders = await prisma.order.count({ 
    where: { helperId: testUserId, status: 'CANCELLED' } 
  });
  
  console.log(`  用户评价数: ${userReviewCount}`);
  console.log(`  用户已完成订单: ${userCompletedOrders}`);
  console.log(`  用户已取消订单: ${userCancelledOrders}\n`);

  // 测试 1: Review 复合索引查询
  console.log('🔍 测试 1: Review 复合索引查询 (reviewee_id + created_at DESC)');
  await benchmark(
    async () => {
      return prisma.review.findMany({
        where: { revieweeId: testUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    },
    iterations,
    'Review 复合索引查询'
  );

  // 测试 2: Order 复合索引查询 (helper_id + status)
  console.log('\n🔍 测试 2: Order 复合索引查询 (helper_id + status)');
  await benchmark(
    async () => {
      return prisma.order.count({
        where: {
          helperId: testUserId,
          status: 'COMPLETED',
        },
      });
    },
    iterations,
    'Order 复合索引查询'
  );

  // 测试 3: Order 反向复合索引查询 (status + helper_id)
  console.log('\n🔍 测试 3: Order 反向复合索引查询 (status + helper_id)');
  await benchmark(
    async () => {
      return prisma.order.count({
        where: {
          status: 'COMPLETED',
          helperId: testUserId,
        },
      });
    },
    iterations,
    'Order 反向复合索引查询'
  );

  // 测试 4: 信用分计算完整流程
  console.log('\n🔍 测试 4: 信用分计算完整流程');
  await benchmark(
    async () => {
      const reviews = await prisma.review.findMany({
        where: { revieweeId: testUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const completedCount = await prisma.order.count({
        where: {
          helperId: testUserId,
          status: 'COMPLETED',
        },
      });

      const cancelCount = await prisma.order.count({
        where: {
          status: 'CANCELLED',
          helperId: testUserId,
        },
      });

      return { reviews: reviews.length, completedCount, cancelCount };
    },
    iterations,
    '信用分计算完整流程'
  );

  // 测试 5: 对比测试 - 有/无 take 限制
  console.log('\n🔍 测试 5: Review 查询 - 有/无 take 限制对比');
  
  console.log('  无 take 限制（全量查询）:');
  await benchmark(
    async () => {
      return prisma.review.findMany({
        where: { revieweeId: testUserId },
      });
    },
    iterations,
    '全量查询'
  );
  
  console.log('  有 take 50 限制:');
  await benchmark(
    async () => {
      return prisma.review.findMany({
        where: { revieweeId: testUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    },
    iterations,
    '限制查询'
  );
}

async function benchmark(
  fn: () => Promise<any>,
  iterations: number,
  testName: string
) {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fn();
    const end = Date.now();
    times.push(end - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

  console.log(`    平均: ${avg.toFixed(2)}ms | 最小: ${min}ms | 最大: ${max}ms | P95: ${p95}ms`);
}

main()
  .catch((e) => {
    console.error('❌ 测试失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
