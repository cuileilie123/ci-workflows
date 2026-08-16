/* eslint-disable no-console */
/**
 * 查当前小程序实际登录的用户（nickname='用户XxdnKM'），以及他是否有待确认改价任务
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('===== 查找用户「用户XxdnKM」 =====');
  const users = await prisma.user.findMany({
    where: { nickname: '用户XxdnKM' },
    include: { _count: { select: { publishedTasks: true } } },
  });
  console.log(`找到匹配用户数: ${users.length}`);
  for (const u of users) {
    console.log(`  - id=${u.id} openid=${u.openid} nick=${u.nickname} role=${u.role} 发布任务数=${u._count.publishedTasks}`);
  }

  // 同时列出所有有 PRICE_PENDING 任务的发布者
  console.log('\n===== 当前所有 PRICE_PENDING 任务及其发布者 =====');
  const pendingTasks = await prisma.task.findMany({
    where: { status: 'PRICE_PENDING' },
    include: {
      publisher: { select: { id: true, nickname: true, openid: true } },
      priceModifications: { where: { status: 'PENDING' } },
    },
  });
  for (const t of pendingTasks) {
    console.log(`任务 #${t.id}: ${t.title}`);
    console.log(`  发布者: id=${t.publisher.id} nick=${t.publisher.nickname} openid=${t.publisher.openid}`);
    for (const m of t.priceModifications) {
      console.log(`  改价单 ¥${m.oldPrice} → ¥${m.newPrice}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
