/* eslint-disable no-console */
/**
 * 模拟补差订单支付回调（直接执行回调中的 DB 操作）
 * 验证：补差订单 PAID + 任务回到 OPEN + helperId 清空
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('===== 模拟补差订单 #7 支付回调 =====\n');

  // 1. 回调前状态
  const before = await prisma.order.findUnique({
    where: { id: 7n },
    include: { task: { select: { id: true, title: true, status: true, price: true, helperId: true } } },
  });
  console.log('回调前:');
  console.log(`  订单 #${before.id}: status=${before.status}, isSupplement=${before.isSupplement}, totalAmount=¥${before.totalAmount}`);
  console.log(`  任务 #${before.task.id}: status=${before.task.status}, price=¥${before.task.price}, helperId=${before.task.helperId}`);

  // 2. 模拟 handleNotify 中对补差订单的处理逻辑
  // (来自 payment.service.ts 第193-214行)
  console.log('\n执行回调逻辑（补差订单分支）...');
  await prisma.$transaction(async (tx) => {
    // 1. 更新补差订单为 PAID
    await tx.order.update({
      where: { id: 7n },
      data: { status: 'PAID', paidAt: new Date() },
    });
    console.log('  ✅ 补差订单已标记 PAID');

    // 2. 任务从 PRICE_PENDING 回到 OPEN
    await tx.task.update({
      where: { id: 37n },
      data: { status: 'OPEN', helperId: null },
    });
    console.log('  ✅ 任务已回到 OPEN（补差完成，重新待接单）');
  });

  // 3. 回调后状态
  const after = await prisma.order.findUnique({
    where: { id: 7n },
    include: { task: { select: { id: true, title: true, status: true, price: true, helperId: true } } },
  });
  console.log('\n回调后:');
  console.log(`  订单 #${after.id}: status=${after.status}, isSupplement=${after.isSupplement}, paidAt=${after.paidAt?.toISOString()}`);
  console.log(`  任务 #${after.task.id}: status=${after.task.status}, price=¥${after.task.price}, helperId=${after.task.helperId ?? 'null'}`);

  // 4. 验证
  console.log('\n===== 验证结果 =====');
  const checks = [
    { name: '补差订单状态 = PAID', pass: after.status === 'PAID' },
    { name: '任务状态 = OPEN', pass: after.task.status === 'OPEN' },
    { name: '任务价格 = ¥70', pass: Number(after.task.price) === 70 },
    { name: '任务 helperId = null', pass: after.task.helperId === null },
  ];
  for (const c of checks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);
  }

  // 5. 汇总所有订单
  console.log('\n===== 任务 #37 的所有订单 =====');
  const allOrders = await prisma.order.findMany({
    where: { taskId: 37n },
    orderBy: { createdAt: 'asc' },
  });
  for (const o of allOrders) {
    console.log(`  订单 #${o.id}: ${o.isSupplement ? '补差' : '原始'} | status=${o.status} | amount=¥${o.totalAmount} | platformFee=¥${o.platformFee} | paidAt=${o.paidAt?.toISOString() ?? 'null'}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
