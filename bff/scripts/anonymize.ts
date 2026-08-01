// 脱敏工具：用于测试环境数据导出
// 运行: npx ts-node scripts/anonymize.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function anonymize() {
  console.log('🔒 开始数据脱敏...');

  // 1. 脱敏用户表
  const users = await prisma.user.findMany();
  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        phone: `1${Math.floor(3 + Math.random() * 6)}${String(Math.floor(Math.random() * 10000000000)).padStart(10, '0')}`,
        nickname: `用户${user.id}`,
        avatar: `https://placeholder.com/avatar/${user.id}.png`,
        deviceFp: null,
      },
    });
  }
  console.log(`✅ 已脱敏 ${users.length} 条用户记录`);

  // 2. 脱敏地址（任务表）
  const tasks = await prisma.task.findMany();
  const sampleAddresses = [
    '北京市朝阳区建国路88号',
    '上海市浦东新区陆家嘴金融中心',
    '广州市天河区珠江新城',
    '深圳市南山区科技园',
    '成都市锦江区春熙路',
    '杭州市西湖区文三路',
    '武汉市武昌区东湖路',
    '西安市雁塔区小寨',
  ];
  for (const task of tasks) {
    const addr = sampleAddresses[Math.floor(Math.random() * sampleAddresses.length)];
    await prisma.task.update({
      where: { id: task.id },
      data: {
        address: addr,
        description: `脱敏后的任务描述 #${task.id}`,
      },
    });
  }
  console.log(`✅ 已脱敏 ${tasks.length} 条任务记录`);

  // 3. 脱敏交易金额（保留统计意义）
  const transactions = await prisma.transaction.findMany();
  for (const tx of transactions) {
    const fakeAmount = parseFloat((Math.random() * 990 + 10).toFixed(2));
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        amount: fakeAmount,
        description: `脱敏交易 #${tx.id}`,
      },
    });
  }
  console.log(`✅ 已脱敏 ${transactions.length} 条交易记录`);

  // 4. 脱敏评价
  const reviews = await prisma.review.findMany();
  const sampleComments = ['服务很好', '态度不错', '速度很快', '专业耐心', '推荐'];
  for (const review of reviews) {
    await prisma.review.update({
      where: { id: review.id },
      data: {
        comment: sampleComments[Math.floor(Math.random() * sampleComments.length)],
      },
    });
  }
  console.log(`✅ 已脱敏 ${reviews.length} 条评价记录`);

  // 5. 脱敏工单
  const tickets = await prisma.ticket.findMany();
  for (const ticket of tickets) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        subject: `工单 #${ticket.id}`,
        content: `脱敏后的工单内容 #${ticket.id}`,
        satisfaction: null,
      },
    });
  }
  console.log(`✅ 已脱敏 ${tickets.length} 条工单记录`);

  console.log('🎉 脱敏完成！数据可安全用于测试环境');
}

anonymize()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
