/* 临时冒烟测试种子脚本：插入一个测试用户 + 一条 OPEN 任务，验证列表/搜索 */
import { PrismaClient } from '@prisma/client';
import * as ngeohash from 'ngeohash';

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  // 1. upsert 测试用户
  const user = await prisma.user.upsert({
    where: { openid: 'smoke_test_openid' },
    update: {},
    create: {
      openid: 'smoke_test_openid',
      nickname: '冒烟测试员',
      creditScore: 100,
      role: 'USER',
      status: 'ACTIVE',
    },
  });

  // 2. 清理旧冒烟任务
  await prisma.task.deleteMany({ where: { title: { contains: '冒烟测试' } } });

  // 3. 插入一条 OPEN 任务（北京坐标，geohash 与 BFF 逻辑一致）
  const lat = 39.9042;
  const lng = 116.4074;
  const geohash = ngeohash.encode(lat, lng, 7);

  const task = await prisma.task.create({
    data: {
      publisherId: user.id,
      title: '冒烟测试-代拿快递',
      description: '这是一条冒烟测试任务，用于验证附近任务列表与搜索功能是否正常工作。',
      price: 5.5,
      lat,
      lng,
      geohash,
      address: '北京市东城区',
      category: 'DELIVERY',
      status: 'OPEN',
      expireAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });

  // eslint-disable-next-line no-console
  console.log(`SEED_OK user=${user.id} task=${task.id} geohash=${geohash}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('SEED_FAIL', e);
  process.exit(1);
});
