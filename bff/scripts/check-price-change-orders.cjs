/* eslint-disable no-console */
/**
 * 检查改价测试任务关联的订单和钱包状态
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('===== 检查测试任务关联的订单 =====');
  const tasks = await prisma.task.findMany({
    where: { title: { contains: '改价测试' } },
    include: {
      publisher: { select: { id: true, nickname: true } },
      category: { select: { id: true, code: true, name: true } },
      priceModifications: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: { id: 'asc' },
  });

  for (const t of tasks) {
    console.log(`\n任务 #${t.id}: ${t.title}`);
    console.log(`  状态: ${t.status}`);
    console.log(`  价格: ¥${t.price}`);
    console.log(`  helperId: ${t.helperId ?? 'null'}`);
    console.log(`  发布者: ${t.publisher.nickname} (ID: ${t.publisher.id})`);

    // 查关联订单
    const orders = await prisma.order.findMany({
      where: { taskId: t.id },
      include: { task: { select: { title: true } } },
    });
    console.log(`  关联订单数: ${orders.length}`);
    for (const o of orders) {
      console.log(`    订单 #${o.id}: totalAmount=¥${o.totalAmount} status=${o.status} platformFee=¥${o.platformFee} helperId=${o.helperId} refundAmount=${o.refundAmount ?? 'null'}`);
    }

    // 查改价单
    console.log(`  改价单数: ${t.priceModifications.length}`);
    for (const m of t.priceModifications) {
      console.log(`    改价单 #${m.id}: ¥${m.oldPrice} → ¥${m.newPrice} status=${m.status} previousStatus=${m.previousStatus}`);
    }
  }

  // 查发布者钱包
  console.log('\n===== 发布者钱包 =====');
  const publisher = tasks[0]?.publisher;
  if (publisher) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: publisher.id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { order: { select: { id: true, taskId: true } } },
        },
      },
    });
    if (wallet) {
      console.log(`钱包 #${wallet.id}: balance=¥${wallet.balance} frozen=¥${wallet.frozen}`);
      console.log(`最近 10 笔流水:`);
      for (const tx of wallet.transactions) {
        console.log(`  流水 #${tx.id}: type=${tx.type} amount=¥${tx.amount} balanceAfter=¥${tx.balanceAfter} desc="${tx.description}" orderId=${tx.orderId ?? 'null'}`);
      }
    } else {
      console.log('发布者无钱包记录');
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
