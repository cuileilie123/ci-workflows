/**
 * 信用分复合索引性能测试
 * 运行方式: npx ts-node prisma/test-index-performance.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 开始信用分复合索引性能测试\n');

  // 1. 生成模拟数据
  console.log('📊 步骤 1: 生成模拟测试数据...');
  await seedTestData();
  
  // 2. 检查数据量
  console.log('\n📊 步骤 2: 检查数据量...');
  await checkDataVolume();

  // 3. 性能测试
  console.log('\n⚡ 步骤 3: 执行性能测试...');
  await performanceTests();

  console.log('\n✅ 测试完成！');
}

async function seedTestData() {
  // 生成模拟订单
  console.log('  生成模拟订单...');
  const orders = [];
  const tasks = await prisma.task.findMany({ take: 50 });
  
  for (let i = 0; i < 500; i++) {
    const task = tasks[Math.floor(Math.random() * tasks.length)];
    if (!task) continue;
    
    orders.push({
      taskId: task.id,
      helperId: BigInt(Math.floor(Math.random() * 100) + 1),
      totalAmount: (50 + Math.random() * 450).toFixed(2),
      platformFee: ((50 + Math.random() * 450) * 0.1).toFixed(2),
      status: ['PENDING', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED'][
        Math.floor(Math.random() * 6)
      ] as any,
      createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    });
  }

  await prisma.order.createMany({
    data: orders as any,
    skipDuplicates: true,
  });
  console.log(`  ✅ 已生成 ${orders.length} 条订单`);

  // 生成模拟评价
  console.log('  生成模拟评价...');
  const completedOrders = await prisma.order.findMany({
    where: { status: 'COMPLETED' },
    take: 300,
  });

  const reviews = [];
  for (const order of completedOrders) {
    reviews.push({
      orderId: order.id,
      reviewerId: BigInt((Number(order.taskId) % 100) + 1),
      revieweeId: order.helperId,
      rating: Math.floor(Math.random() * 5) + 1,
      tags: [
        ['准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'][Math.floor(Math.random() * 5)],
        ['准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'][Math.floor(Math.random() * 5)],
      ],
      comment: `模拟评价内容${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
    });
  }

  await prisma.review.createMany({
    data: reviews as any,
    skipDuplicates: true,
  });
  console.log(`  ✅ 已生成 ${reviews.length} 条评价`);
}

async function checkDataVolume() {
  const orderCount = await prisma.order.count();
  const reviewCount = await prisma.review.count();
  
  console.log(`  📦 orders 表: ${orderCount} 条记录`);
  console.log(`  📦 reviews 表: ${reviewCount} 条记录`);
}

async function performanceTests() {
  const testUserId = BigInt(5);
  const iterations = 10;

  // 测试 1: Review 复合索引查询
  console.log('\n🔍 测试 1: Review 复合索引查询 (reviewee_id + created_at DESC)');
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
          OR: [
            { helperId: testUserId, status: 'COMPLETED' },
            { task: { publisherId: testUserId }, status: 'COMPLETED' },
          ],
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

  // 测试 5: Review 全量查询（无限制，模拟 bug）
  console.log('\n🔍 测试 5: Review 全量查询（无限制，模拟 getCreditDetail bug）');
  await benchmark(
    async () => {
      return prisma.review.findMany({
        where: { revieweeId: testUserId },
      });
    },
    iterations,
    'Review 全量查询（无限制）'
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

  console.log(`  平均耗时: ${avg.toFixed(2)}ms`);
  console.log(`  最小耗时: ${min}ms`);
  console.log(`  最大耗时: ${max}ms`);
  console.log(`  P95耗时: ${p95}ms`);
}

main()
  .catch((e) => {
    console.error('❌ 测试失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
