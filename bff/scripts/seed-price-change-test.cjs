/* eslint-disable no-console */
/**
 * 构造模拟数据：测试工作人员修改订单价格后，发布者端能否正确看到待确认状态和差额提示
 *
 * 流程：
 *   1. upsert 发布者用户（mock_publisher）
 *   2. upsert 工作人员用户（mock_staff）
 *   3. upsert 测试任务分类
 *   4. 清理旧的测试改价任务
 *   5. 创建两条 OPEN 任务：
 *      - 任务 A：原价 100 → 改价 80（退差 20 元场景）
 *      - 任务 B：原价 50  → 改价 70（补差 20 元场景）
 *   6. 为每条任务创建 PENDING 改价单，并将任务状态置为 PRICE_PENDING
 *   7. 打印发布者登录信息与任务 ID，便于在小程序端验证
 *
 * 运行：
 *   $env:DATABASE_URL="mysql://root:root123@localhost:3306/neighborhood_help"
 *   node bff/scripts/seed-price-change-test.cjs
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const ngeohash = require('ngeohash');

const prisma = new PrismaClient();

async function main() {
  console.log('=== 构造改价测试数据 ===\n');

  // 1. 发布者
  const publisher = await prisma.user.upsert({
    where: { openid: 'mock_price_change_publisher' },
    update: {},
    create: {
      openid: 'mock_price_change_publisher',
      nickname: '改价测试-发布者',
      creditScore: 100,
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  console.log(`发布者: id=${publisher.id}, nickname=${publisher.nickname}`);

  // 2. 工作人员
  const staff = await prisma.user.upsert({
    where: { openid: 'mock_price_change_staff' },
    update: {},
    create: {
      openid: 'mock_price_change_staff',
      nickname: '改价测试-工作人员',
      creditScore: 100,
      role: 'STAFF',
      status: 'ACTIVE',
    },
  });
  console.log(`工作人员: id=${staff.id}, nickname=${staff.nickname}`);

  // 3. 任务分类
  const category = await prisma.taskCategory.upsert({
    where: { code: 'TEST_PRICE' },
    update: {},
    create: {
      code: 'TEST_PRICE',
      name: '改价测试分类',
      sort: 999,
      isActive: true,
    },
  });
  console.log(`任务分类: id=${category.id}, code=${category.code}\n`);

  // 4. 清理旧的测试改价任务（先删改价单再删任务）
  const oldTasks = await prisma.task.findMany({
    where: { title: { contains: '改价测试' } },
    select: { id: true },
  });
  if (oldTasks.length > 0) {
    await prisma.priceModification.deleteMany({
      where: { taskId: { in: oldTasks.map((t) => t.id) } },
    });
    await prisma.task.deleteMany({
      where: { id: { in: oldTasks.map((t) => t.id) } },
    });
    console.log(`已清理 ${oldTasks.length} 条旧测试任务\n`);
  }

  // 5. 创建测试任务
  const lat = 39.994;
  const lng = 116.479;
  const geohash = ngeohash.encode(lat, lng, 7);
  const expireAt = new Date(Date.now() + 24 * 3600 * 1000);

  // 任务 A：退差场景 100 → 80
  const taskA = await prisma.task.create({
    data: {
      publisherId: publisher.id,
      title: '改价测试A-代取快递（退差场景）',
      description: '原价 100 元，工作人员改价为 80 元，发布者确认后将退回 20 元差额。',
      price: new Prisma.Decimal(100.0),
      lat,
      lng,
      geohash,
      address: '北京市朝阳区望京街道',
      categoryId: category.id,
      urgency: 'NORMAL',
      images: [],
      status: 'OPEN',
      expireAt,
    },
  });
  console.log(`任务 A: id=${taskA.id}, title=${taskA.title}, price=${taskA.price}`);

  // 任务 B：补差场景 50 → 70
  const taskB = await prisma.task.create({
    data: {
      publisherId: publisher.id,
      title: '改价测试B-代买午餐（补差场景）',
      description: '原价 50 元，工作人员改价为 70 元，发布者确认后需补付 20 元差额。',
      price: new Prisma.Decimal(50.0),
      lat,
      lng,
      geohash,
      address: '北京市朝阳区望京SOHO',
      categoryId: category.id,
      urgency: 'HIGH',
      images: [],
      status: 'OPEN',
      expireAt,
    },
  });
  console.log(`任务 B: id=${taskB.id}, title=${taskB.title}, price=${taskB.price}\n`);

  // 6. 创建改价单并冻结任务为 PRICE_PENDING
  // 任务 A：100 → 80（退差）
  const modA = await prisma.priceModification.create({
    data: {
      taskId: taskA.id,
      staffId: staff.id,
      oldPrice: taskA.price,
      newPrice: new Prisma.Decimal(80.0),
      reason: '市场行情调整，原价偏高，建议降为 80 元',
      previousStatus: 'OPEN',
      status: 'PENDING',
    },
  });
  await prisma.task.update({
    where: { id: taskA.id },
    data: { status: 'PRICE_PENDING' },
  });
  console.log(`改价单 A: id=${modA.id}, ${modA.oldPrice} → ${modA.newPrice}（退差 20 元）`);
  console.log(`任务 A 状态已置为 PRICE_PENDING\n`);

  // 任务 B：50 → 70（补差）
  const modB = await prisma.priceModification.create({
    data: {
      taskId: taskB.id,
      staffId: staff.id,
      oldPrice: taskB.price,
      newPrice: new Prisma.Decimal(70.0),
      reason: '任务紧急程度较高，建议上调至 70 元',
      previousStatus: 'OPEN',
      status: 'PENDING',
    },
  });
  await prisma.task.update({
    where: { id: taskB.id },
    data: { status: 'PRICE_PENDING' },
  });
  console.log(`改价单 B: id=${modB.id}, ${modB.oldPrice} → ${modB.newPrice}（补差 20 元）`);
  console.log(`任务 B 状态已置为 PRICE_PENDING\n`);

  // 7. 打印验证指引
  console.log('======================== 验证指引 ========================');
  console.log(`发布者用户 ID: ${publisher.id} (openid: ${publisher.openid})`);
  console.log(`工作人员用户 ID: ${staff.id} (openid: ${staff.openid})`);
  console.log('');
  console.log('【小程序端验证步骤】');
  console.log(`1. 以发布者身份登录（用户 ID: ${publisher.id}）`);
  console.log(`2. 进入「我的」页面，应看到「待确认改价」卡片，显示 2 笔`);
  console.log(`3. 点击任务 A（退差场景）：`);
  console.log(`   - 任务详情应显示「改价待确认」状态`);
  console.log(`   - 改价卡片：原价 ¥100.00 → 新价 ¥80.00`);
  console.log(`   - 差额提示：差额 -¥20.00（确认后将退回差额）`);
  console.log(`   - 点击「确认改价」→ 应提示「已确认，差额已退回钱包」`);
  console.log(`   - 点击「拒绝改价」→ 任务恢复 OPEN 状态，价格保持 100`);
  console.log(`4. 点击任务 B（补差场景）：`);
  console.log(`   - 改价卡片：原价 ¥50.00 → 新价 ¥70.00`);
  console.log(`   - 差额提示：差额 +¥20.00（确认后需补差支付）`);
  console.log(`   - 点击「确认改价」→ 应提示「已确认，请完成补差支付」`);
  console.log('========================================================');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('构造测试数据失败:', e.message);
  if (e.code === 'P1001') {
    console.error('\n数据库连接失败，请确认：');
    console.error('  1. MySQL 服务已启动（docker compose up -d mysql）');
    console.error('  2. DATABASE_URL 环境变量已正确设置');
    console.error('  3. 数据库 neighborhood_help 已创建');
  }
  process.exit(1);
});
