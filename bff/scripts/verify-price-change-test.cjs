/* eslint-disable no-console */
/** 验证改价测试数据是否正确写入 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== 验证改价测试数据 ===\n');

  const tasks = await prisma.task.findMany({
    where: { title: { contains: '改价测试' } },
    include: {
      publisher: { select: { id: true, nickname: true, openid: true } },
      category: { select: { id: true, code: true, name: true } },
      priceModifications: true,
    },
    orderBy: { id: 'asc' },
  });

  for (const t of tasks) {
    console.log(`任务 #${t.id}: ${t.title}`);
    console.log(`  状态: ${t.status}`);
    console.log(`  当前价格: ¥${t.price}`);
    console.log(`  发布者: ${t.publisher.nickname} (ID: ${t.publisher.id}, openid: ${t.publisher.openid})`);
    console.log(`  分类: ${t.category.code} (${t.category.name})`);
    console.log(`  改价单数量: ${t.priceModifications.length}`);
    for (const m of t.priceModifications) {
      const diff = Number(m.newPrice) - Number(m.oldPrice);
      console.log(`    - 改价单 #${m.id}: ¥${m.oldPrice} → ¥${m.newPrice} (差额 ${diff > 0 ? '+' : ''}${diff})`);
      console.log(`      状态: ${m.status}, 原状态: ${m.previousStatus}`);
      console.log(`      原因: ${m.reason || '(无)'}`);
    }
    console.log('');
  }

  // 验证发布者待确认改价单查询（模拟 OrderPriceService.findMyPendingPriceChanges）
  const publisherId = tasks[0]?.publisherId;
  if (publisherId) {
    const pending = await prisma.priceModification.findMany({
      where: { task: { publisherId }, status: 'PENDING' },
      include: { task: { select: { id: true, title: true, price: true } } },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`发布者 ${publisherId} 的待确认改价单: ${pending.length} 笔`);
    for (const p of pending) {
      console.log(`  - 任务 #${p.taskId}: ${p.task.title}`);
      console.log(`    ¥${p.oldPrice} → ¥${p.newPrice}, 原因: ${p.reason || '(无)'}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('验证失败:', e.message);
  process.exit(1);
});
