/* eslint-disable no-console */
/**
 * 模拟补差订单支付回调（直接执行回调中的 DB 操作）
 * 验证：补差订单 PAID + 任务回到 previousStatus + helperId 保留 + 冻结新增差额
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SUPPLEMENT_ORDER_ID = 10n;
const TASK_ID = 39n;

async function main() {
  console.log('===== 模拟补差订单 #10 支付回调 =====\n');

  // 1. 回调前状态
  const before = await prisma.order.findUnique({
    where: { id: SUPPLEMENT_ORDER_ID },
    include: { task: { select: { id: true, title: true, status: true, price: true, helperId: true } } },
  });
  console.log('回调前:');
  console.log(`  订单 #${before.id}: status=${before.status}, isSupplement=${before.isSupplement}, totalAmount=¥${before.totalAmount}, platformFee=¥${before.platformFee}`);
  console.log(`  任务 #${before.task.id}: status=${before.task.status}, price=¥${before.task.price}, helperId=${before.task.helperId}`);

  // 查改价单获取 previousStatus
  const priceMod = await prisma.priceModification.findFirst({
    where: { taskId: TASK_ID, status: 'CONFIRMED' },
    orderBy: { createdAt: 'desc' },
    select: { previousStatus: true },
  });
  const returnStatus = priceMod?.previousStatus || 'ASSIGNED';
  console.log(`  改价单 previousStatus=${returnStatus}`);

  // 2. 模拟 handleNotify 中对补差订单的处理逻辑
  console.log('\n执行回调逻辑（补差订单分支）...');
  await prisma.$transaction(async (tx) => {
    // 1. 更新补差订单为 PAID
    await tx.order.update({
      where: { id: SUPPLEMENT_ORDER_ID },
      data: { status: 'PAID', paidAt: new Date() },
    });
    console.log('  ✅ 补差订单已标记 PAID');

    // 2. 任务回到 previousStatus（保留 helperId）
    await tx.task.update({
      where: { id: TASK_ID },
      data: { status: returnStatus },
    });
    console.log(`  ✅ 任务已回到 ${returnStatus}（保留 helperId）`);
  });

  // 3. 冻结补差额中的接单者部分（在事务外执行，与普通订单回调一致）
  const freezeAmount = Number(before.totalAmount) - Number(before.platformFee);
  if (freezeAmount > 0) {
    const helperWallet = await prisma.wallet.findUnique({ where: { userId: before.helperId } });
    if (helperWallet) {
      const newFrozen = Number(helperWallet.frozen) + freezeAmount;
      await prisma.wallet.update({
        where: { id: helperWallet.id },
        data: { frozen: newFrozen },
      });
      await prisma.transaction.create({
        data: {
          walletId: helperWallet.id,
          orderId: SUPPLEMENT_ORDER_ID,
          type: 'FREEZE',
          amount: freezeAmount,
          balanceAfter: Number(helperWallet.balance),
          description: `补差支付-增加冻结（任务 ${TASK_ID.toString()}）`,
        },
      });
      console.log(`  ✅ 接单者冻结金额增加 ¥${freezeAmount}（¥${helperWallet.frozen} → ¥${newFrozen}）`);
    }
  }

  // 4. 回调后状态
  const after = await prisma.order.findUnique({
    where: { id: SUPPLEMENT_ORDER_ID },
    include: { task: { select: { id: true, title: true, status: true, price: true, helperId: true } } },
  });
  console.log('\n回调后:');
  console.log(`  订单 #${after.id}: status=${after.status}, paidAt=${after.paidAt?.toISOString()}`);
  console.log(`  任务 #${after.task.id}: status=${after.task.status}, price=¥${after.task.price}, helperId=${after.task.helperId ?? 'null'}`);

  // 5. 验证
  console.log('\n===== 验证结果 =====');
  const checks = [
    { name: '补差订单状态 = PAID', pass: after.status === 'PAID' },
    { name: `任务状态 = ${returnStatus}`, pass: after.task.status === returnStatus },
    { name: '任务价格 = ¥70', pass: Number(after.task.price) === 70 },
    { name: '任务 helperId 保留 = 999005', pass: after.task.helperId?.toString() === '999005' },
  ];
  for (const c of checks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);
  }

  // 6. 最终钱包状态
  const helperWallet = await prisma.wallet.findUnique({
    where: { userId: 999005n },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
  });
  console.log(`\n接单者钱包最终状态: balance=¥${helperWallet.balance} frozen=¥${helperWallet.frozen}`);
  console.log('最近流水:');
  for (const t of helperWallet.transactions.slice(0, 5)) {
    console.log(`  ${t.type} ¥${t.amount} | ${t.description}`);
  }

  // 预期冻结: 135(初始) - 18(退差) + 18(补差) = 135
  console.log(`\n预期冻结: 135(初始) - 18(退差A) + 18(补差B) = 135`);
  console.log(`实际冻结: ${Number(helperWallet.frozen)}`);
  console.log(Number(helperWallet.frozen) === 135 ? '✅ 冻结金额正确' : '❌ 冻结金额异常');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
