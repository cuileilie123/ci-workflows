/* eslint-disable no-console */
/**
 * 将改价测试任务的发布者改为真实登录用户（id=1）
 * 同时为用户 1 创建 STAFF 权限（可选开启老板权限）
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

const REAL_USER_ID = 1; // 小程序真实登录用户 id
const STAFF_ID = 999004; // 原测试工作人员 id

async function main() {
  // 1. 将改价测试任务的 publisherId 改为真实用户
  const tasks = await prisma.task.findMany({
    where: { title: { contains: '改价测试' } },
    select: { id: true, title: true, publisherId: true },
  });
  console.log(`找到 ${tasks.length} 条改价测试任务，原发布者: ${tasks.map((t) => t.publisherId).join(', ')}`);

  for (const t of tasks) {
    await prisma.task.update({
      where: { id: t.id },
      data: { publisherId: BigInt(REAL_USER_ID) },
    });
    console.log(`  任务 #${t.id} 发布者已改为 id=${REAL_USER_ID}`);
  }

  // 2. 把真实用户的昵称改一下，便于识别
  const realUser = await prisma.user.update({
    where: { id: BigInt(REAL_USER_ID) },
    data: { nickname: '真实用户-发布者改价测试' },
    select: { id: true, nickname: true, role: true },
  });
  console.log(`\n真实用户信息: id=${realUser.id} nick=${realUser.nickname} role=${realUser.role}`);

  // 3. 把真实用户升级为 BOSS（让中端管理入口也能显示，方便测试全部4个功能）
  await prisma.user.update({
    where: { id: BigInt(REAL_USER_ID) },
    data: { role: 'BOSS' },
  });
  console.log('已将真实用户角色升级为 BOSS（中端管理入口可见 + 全部权限）');

  // 4. 再次确认数据
  const verify = await prisma.task.findMany({
    where: { status: 'PRICE_PENDING', publisherId: BigInt(REAL_USER_ID) },
    select: {
      id: true,
      title: true,
      status: true,
      price: true,
      priceModifications: {
        where: { status: 'PENDING' },
        select: { id: true, oldPrice: true, newPrice: true, reason: true },
      },
    },
  });
  console.log(`\n===== 发布者 ${REAL_USER_ID} 的 PRICE_PENDING 任务 =====`);
  for (const t of verify) {
    console.log(`任务 #${t.id}: ${t.title} 价格=${t.price} 状态=${t.status}`);
    for (const m of t.priceModifications) {
      console.log(`  改价单 #${m.id}: ¥${m.oldPrice} → ¥${m.newPrice} (原因: ${m.reason})`);
    }
  }
  console.log(`共 ${verify.length} 条待确认改价任务`);

  await prisma.$disconnect();
  console.log('\n完成。请刷新小程序「我的」页面，应看到：');
  console.log('  1. 紫色「中端管理」入口（因为已升级为 BOSS）');
  console.log('  2. 橙色「待确认改价」卡片（2 笔）');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
