const { PrismaClient } = require('@prisma/client');
const ngeohash = require('ngeohash');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function seedTasks() {
  console.log('=== 插入测试任务数据 ===\n');

  // 北京望京附近坐标
  const locations = [
    { lat: 39.994, lng: 116.479, address: '北京市朝阳区望京街道' },
    { lat: 39.996, lng: 116.481, address: '北京市朝阳区望京SOHO' },
    { lat: 39.992, lng: 116.476, address: '北京市朝阳区阜通东大街' },
    { lat: 39.998, lng: 116.483, address: '北京市朝阳区阜安西路' },
    { lat: 39.990, lng: 116.474, address: '北京市朝阳区广顺南大街' },
  ];

  const categories = ['DELIVERY', 'SHOPPING', 'CLEANING', 'REPAIR', 'OTHER'];
  const urgencies = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
  const titles = [
    '帮忙取个快递到小区门口',
    '代买一杯星巴克咖啡',
    '帮忙排队挂号',
    '取干洗的衣服',
    '帮忙买份午饭',
    '代送文件到隔壁写字楼',
    '帮忙照顾宠物狗2小时',
    '帮忙去超市买点日用品',
    '代取医院检查报告',
    '帮忙搬个小物件到楼上',
  ];

  const descriptions = [
    '快递在菜鸟驿站，取件码已发，麻烦送到小区北门。',
    '要一杯大杯美式，少冰，谢谢！',
    '在人民医院帮忙挂个内科号，大概排队1小时左右。',
    '干洗店在小区对面，取件凭证照片稍后发给你。',
    '帮忙买份盖浇饭，不要太辣，送到小区南门就行。',
    '一份合同文件，需要送到隔壁街的中关村软件园。',
    '我家金毛很乖，帮忙遛2小时就行，狗粮和水都准备好了。',
    '买一些纸巾、洗衣液和牛奶，清单稍后发给你。',
    '帮忙去三甲医院取一下上周的检查报告，挂号费我出。',
    '一个小纸箱，大概5kg左右，从1楼搬到3楼。',
  ];

  // 获取或创建测试用户
  let user = await prisma.user.findFirst({
    where: { nickname: { contains: '测试' } },
  });

  if (!user) {
    console.log('创建测试用户...');
    user = await prisma.user.create({
      data: {
        openid: `test_user_${Date.now()}`,
        nickname: '测试用户-任务发布者',
        avatar: null,
      },
    });
    console.log(`测试用户创建成功，ID: ${user.id}\n`);
  }

  console.log(`使用用户: ${user.nickname} (ID: ${user.id})\n`);

  // 插入任务
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    const loc = locations[i];
    const geohash = ngeohash.encode(loc.lat, loc.lng, 7); // 精度 7，与服务端一致
    const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 小时后过期

    const task = await prisma.task.create({
      data: {
        publisherId: user.id,
        title: titles[i],
        description: descriptions[i],
        price: new Prisma.Decimal((i + 1) * 10 + Math.random() * 5),
        category: categories[i],
        urgency: urgencies[i % urgencies.length],
        lat: loc.lat,
        lng: loc.lng,
        geohash,
        address: loc.address,
        expireAt,
        images: [],
      },
    });

    tasks.push(task);
    console.log(`✅ 任务 ${i + 1}: ${titles[i]}`);
    console.log(`   位置: ${loc.address} (${loc.lat}, ${loc.lng})`);
    console.log(`   GeoHash: ${geohash}`);
    console.log(`   价格: ¥${task.price}`);
    console.log(`   过期: ${expireAt.toLocaleString()}\n`);
  }

  console.log(`\n=== 成功插入 ${tasks.length} 个测试任务 ===`);
  console.log('现在可以测试附近任务列表接口了！');

  await prisma.$disconnect();
}

// 需要导入 Prisma.Decimal
const { Prisma } = require('@prisma/client');

seedTasks().catch(err => {
  console.error('插入任务失败:', err);
  process.exit(1);
});
