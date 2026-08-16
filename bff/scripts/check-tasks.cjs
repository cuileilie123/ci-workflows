const { PrismaClient } = require('@prisma/client');
const ngeohash = require('ngeohash');

const prisma = new PrismaClient();

async function checkTasks() {
  console.log('=== 检查数据库中的任务数据 ===\n');

  // 1. 查看所有任务
  const allTasks = await prisma.task.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { publisher: { select: { nickname: true } } },
  });

  console.log(`数据库中共有 ${allTasks.length} 个任务（最近 10 个）:\n`);
  
  allTasks.forEach((task, i) => {
    const geohash = ngeohash.encode(Number(task.lat), Number(task.lng), 6);
    const neighbors = ngeohash.neighbors(geohash);
    const isExpired = task.expireAt < new Date();
    
    console.log(`${i + 1}. 任务 ID: ${task.id}`);
    console.log(`   标题: ${task.title}`);
    console.log(`   状态: ${task.status}`);
    console.log(`   位置: (${task.lat}, ${task.lng})`);
    console.log(`   GeoHash: ${geohash}`);
    console.log(`   过期时间: ${task.expireAt.toLocaleString()}`);
    console.log(`   是否过期: ${isExpired ? '是' : '否'}`);
    console.log(`   发布者: ${task.publisher?.nickname || '未知'}`);
    console.log('');
  });

  // 2. 检查望京坐标附近的 GeoHash
  const wangjingLat = 39.994;
  const wangjingLng = 116.479;
  const targetHash = ngeohash.encode(wangjingLat, wangjingLng, 6);
  const targetNeighbors = ngeohash.neighbors(targetHash);
  
  console.log(`\n=== 望京坐标 (${wangjingLat}, ${wangjingLng}) 的 GeoHash ===`);
  console.log(`中心 GeoHash: ${targetHash}`);
  console.log(`邻居 GeoHashes: ${targetNeighbors.join(', ')}\n`);

  // 3. 查询匹配的任务
  const allHashes = [targetHash, ...targetNeighbors];
  
  const nearbyTasks = await prisma.task.findMany({
    where: {
      geohash: { in: allHashes },
      status: 'OPEN',
      expireAt: { gt: new Date() },
      deletedAt: null,
    },
    include: { publisher: { select: { nickname: true } } },
  });

  console.log(`匹配的任务数量: ${nearbyTasks.length}`);
  
  if (nearbyTasks.length === 0) {
    console.log('\n原因分析:');
    
    // 检查是否有 OPEN 状态的任务
    const openTasks = await prisma.task.count({ where: { status: 'OPEN' } });
    console.log(`- OPEN 状态的任务: ${openTasks} 个`);
    
    // 检查是否有未过期的任务
    const activeTasks = await prisma.task.count({ 
      where: { expireAt: { gt: new Date() } } 
    });
    console.log(`- 未过期的任务: ${activeTasks} 个`);
    
    // 检查所有任务的 GeoHash
    const tasksWithGeoHash = await prisma.task.findMany({
      select: { geohash: true, lat: true, lng: true, status: true, expireAt: true },
      take: 5,
    });
    
    console.log('\n前 5 个任务的 GeoHash:');
    tasksWithGeoHash.forEach(t => {
      console.log(`  - GeoHash: ${t.geohash}, 状态: ${t.status}, 过期: ${t.expireAt.toLocaleString()}`);
    });
  }

  await prisma.$disconnect();
}

checkTasks().catch(console.error);
