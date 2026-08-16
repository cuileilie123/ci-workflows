const { PrismaClient } = require('@prisma/client');
const ngeohash = require('ngeohash');

const prisma = new PrismaClient();

async function fixGeoHash() {
  console.log('=== 修复任务 GeoHash 精度 ===\n');

  const tasks = await prisma.task.findMany({
    where: { status: 'OPEN' },
  });

  console.log(`找到 ${tasks.length} 个 OPEN 状态的任务\n`);

  let updated = 0;
  for (const task of tasks) {
    const newGeoHash = ngeohash.encode(Number(task.lat), Number(task.lng), 7);
    
    if (task.geohash !== newGeoHash) {
      await prisma.task.update({
        where: { id: task.id },
        data: { geohash: newGeoHash },
      });
      console.log(`✅ 任务 ${task.id}: ${task.geohash} → ${newGeoHash}`);
      updated++;
    } else {
      console.log(`✓ 任务 ${task.id}: ${task.geohash} (已是精度 7)`);
    }
  }

  console.log(`\n=== 更新完成：${updated}/${tasks.length} 个任务已修复 ===`);
  await prisma.$disconnect();
}

fixGeoHash().catch(console.error);
