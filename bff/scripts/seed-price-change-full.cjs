/* eslint-disable no-console */
/**
 * 构造完整改价测试数据（带订单+接单者+冻结金额）
 *
 * 场景：
 *   任务 A（退差）：发布者支付 100 → 接单者冻结 90 → 工作人员改价 80 → 发布者确认 → 退差 20 元
 *   任务 B（补差）：发布者支付 50 → 接单者冻结 45 → 工作人员改价 70 → 发布者确认 → 补差 20 元
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const ngeohash = require('ngeohash');

const prisma = new PrismaClient();

const PUBLISHER_ID = 1n; // 真实小程序登录用户
const STAFF_ID = 999004n; // 测试工作人员

async function main() {
  console.log('=== 构造完整改价测试数据（带订单+接单者+冻结金额）===\n');

  // 1. 确保工作人员存在
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

  // 2. 确保接单者存在
  const helper = await prisma.user.upsert({
    where: { openid: 'mock_price_change_helper' },
    update: {},
    create: {
      openid: 'mock_price_change_helper',
      nickname: '改价测试-接单者',
      creditScore: 100,
      role: 'HELPER',
      status: 'ACTIVE',
    },
  });
  console.log(`接单者: id=${helper.id}, nickname=${helper.nickname}`);

  // 3. 确保任务分类存在
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

  // 4. 清理旧的测试数据（改价单 → 订单 → 流水 → 任务 → 钱包重置）
  const oldTasks = await prisma.task.findMany({
    where: { title: { contains: '改价测试' } },
    select: { id: true },
  });
  if (oldTasks.length > 0) {
    const taskIds = oldTasks.map((t) => t.id);
    await prisma.priceModification.deleteMany({ where: { taskId: { in: taskIds } } });
    const oldOrders = await prisma.order.findMany({ where: { taskId: { in: taskIds } }, select: { id: true } });
    if (oldOrders.length > 0) {
      const orderIds = oldOrders.map((o) => o.id);
      await prisma.transaction.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    console.log(`已清理 ${oldTasks.length} 条旧测试任务\n`);
  }

  // 5. 重置接单者钱包（清除测试流水）
  await prisma.wallet.upsert({
    where: { userId: helper.id },
    update: { balance: new Prisma.Decimal(0), frozen: new Prisma.Decimal(0) },
    create: { userId: helper.id, balance: new Prisma.Decimal(0), frozen: new Prisma.Decimal(0) },
  });

  // 6. 创建任务和订单
  const lat = 39.994;
  const lng = 116.479;
  const geohash = ngeohash.encode(lat, lng, 7);
  const expireAt = new Date(Date.now() + 24 * 3600 * 1000);

  // ===== 任务 A（退差场景）：原价 100，接单者冻结 90 =====
  const taskA = await prisma.task.create({
    data: {
      publisherId: PUBLISHER_ID,
      title: '改价测试A-代取快递（退差场景）',
      description: '发布者已支付 100 元，接单者已接单，工作人员改价为 80 元。',
      price: new Prisma.Decimal(100.0),
      lat, lng, geohash,
      address: '北京市朝阳区望京街道',
      categoryId: category.id,
      urgency: 'NORMAL',
      images: [],
      status: 'IN_PROGRESS',
      helperId: helper.id,
      expireAt,
    },
  });

  // 任务 A 的订单（已支付）
  const orderA = await prisma.order.create({
    data: {
      taskId: taskA.id,
      helperId: helper.id,
      totalAmount: new Prisma.Decimal(100.0),
      platformFee: new Prisma.Decimal(10.0), // 10% 平台抽成
      status: 'PAID',
      isSupplement: false,
      paidAt: new Date(),
    },
  });

  // 接单者钱包冻结 90 元（100 - 10 平台费）
  const helperWalletA = await prisma.wallet.findUnique({ where: { userId: helper.id } });
  const newFrozenA = Number(helperWalletA.frozen) + 90;
  await prisma.wallet.update({
    where: { id: helperWalletA.id },
    data: { frozen: new Prisma.Decimal(newFrozenA) },
  });
  await prisma.transaction.create({
    data: {
      walletId: helperWalletA.id,
      orderId: orderA.id,
      type: 'FREEZE',
      amount: new Prisma.Decimal(90),
      balanceAfter: Number(helperWalletA.balance),
      description: '任务报酬（冻结）- 改价测试A',
    },
  });

  // 任务 A 的改价单（100 → 80）
  const modA = await prisma.priceModification.create({
    data: {
      taskId: taskA.id,
      staffId: STAFF_ID,
      oldPrice: taskA.price,
      newPrice: new Prisma.Decimal(80.0),
      reason: '市场行情调整，原价偏高，建议降为 80 元',
      previousStatus: 'IN_PROGRESS',
      status: 'PENDING',
    },
  });
  await prisma.task.update({ where: { id: taskA.id }, data: { status: 'PRICE_PENDING' } });

  console.log(`任务 A: id=${taskA.id}, 原价=¥100, 改价=¥80（退差 20 元）`);
  console.log(`  订单 #${orderA.id}: PAID, totalAmount=¥100, platformFee=¥10`);
  console.log(`  接单者钱包冻结: ¥${newFrozenA}`);
  console.log(`  改价单 #${modA.id}: PENDING, 100→80`);
  console.log(`  任务状态: PRICE_PENDING\n`);

  // ===== 任务 B（补差场景）：原价 50，接单者冻结 45 =====
  const taskB = await prisma.task.create({
    data: {
      publisherId: PUBLISHER_ID,
      title: '改价测试B-代买午餐（补差场景）',
      description: '发布者已支付 50 元，接单者已接单，工作人员改价为 70 元。',
      price: new Prisma.Decimal(50.0),
      lat, lng, geohash,
      address: '北京市朝阳区望京SOHO',
      categoryId: category.id,
      urgency: 'HIGH',
      images: [],
      status: 'IN_PROGRESS',
      helperId: helper.id,
      expireAt,
    },
  });

  // 任务 B 的订单（已支付）
  const orderB = await prisma.order.create({
    data: {
      taskId: taskB.id,
      helperId: helper.id,
      totalAmount: new Prisma.Decimal(50.0),
      platformFee: new Prisma.Decimal(5.0), // 10% 平台抽成
      status: 'PAID',
      isSupplement: false,
      paidAt: new Date(),
    },
  });

  // 接单者钱包再冻结 45 元（50 - 5 平台费）
  const helperWalletB = await prisma.wallet.findUnique({ where: { userId: helper.id } });
  const newFrozenB = Number(helperWalletB.frozen) + 45;
  await prisma.wallet.update({
    where: { id: helperWalletB.id },
    data: { frozen: new Prisma.Decimal(newFrozenB) },
  });
  await prisma.transaction.create({
    data: {
      walletId: helperWalletB.id,
      orderId: orderB.id,
      type: 'FREEZE',
      amount: new Prisma.Decimal(45),
      balanceAfter: Number(helperWalletB.balance),
      description: '任务报酬（冻结）- 改价测试B',
    },
  });

  // 任务 B 的改价单（50 → 70）
  const modB = await prisma.priceModification.create({
    data: {
      taskId: taskB.id,
      staffId: STAFF_ID,
      oldPrice: taskB.price,
      newPrice: new Prisma.Decimal(70.0),
      reason: '任务紧急程度较高，建议上调至 70 元',
      previousStatus: 'IN_PROGRESS',
      status: 'PENDING',
    },
  });
  await prisma.task.update({ where: { id: taskB.id }, data: { status: 'PRICE_PENDING' } });

  console.log(`任务 B: id=${taskB.id}, 原价=¥50, 改价=¥70（补差 20 元）`);
  console.log(`  订单 #${orderB.id}: PAID, totalAmount=¥50, platformFee=¥5`);
  console.log(`  接单者钱包冻结: ¥${newFrozenB}（累计）`);
  console.log(`  改价单 #${modB.id}: PENDING, 50→70`);
  console.log(`  任务状态: PRICE_PENDING\n`);

  // ===== 验证指引 =====
  console.log('======================== 验证指引 ========================');
  console.log(`发布者: id=${PUBLISHER_ID}（小程序真实用户，BOSS 角色）`);
  console.log(`接单者: id=${helper.id}, 钱包冻结=¥${newFrozenB}`);
  console.log(`工作人员: id=${staff.id}`);
  console.log('');
  console.log('【退差场景 - 任务 A】');
  console.log(`  1. 发布者确认改价 → settlement 应返回 "REFUNDED"`);
  console.log(`  2. 发布者钱包应 +¥20（退差）`);
  console.log(`  3. 接单者冻结应 -¥90（解冻）`);
  console.log(`  4. 任务状态 → OPEN, price → ¥80`);
  console.log('');
  console.log('【补差场景 - 任务 B】');
  console.log(`  1. 发布者确认改价 → settlement 应返回 "SUPPLEMENT_PENDING"`);
  console.log(`  2. 应创建一笔 PENDING 补差订单（isSupplement=true, amount=¥20）`);
  console.log(`  3. 任务状态保持 PRICE_PENDING（等待补差支付）`);
  console.log(`  4. 调用 POST /pay/pay-supplement/:taskId → 返回支付参数`);
  console.log(`  5. 模拟支付回调 → 补差订单 PAID + 任务回到 OPEN`);
  console.log(`  6. 接单者冻结应 -¥45（解冻）`);
  console.log('========================================================');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('构造测试数据失败:', e.message);
  process.exit(1);
});
