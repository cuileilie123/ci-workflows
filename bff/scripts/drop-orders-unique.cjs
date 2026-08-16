/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 查找 orders 表上的外键约束名
  const constraints = await prisma.$queryRawUnsafe(`
    SELECT CONSTRAINT_NAME 
    FROM information_schema.KEY_COLUMN_USAGE 
    WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'task_id' 
    AND TABLE_SCHEMA = 'neighborhood_help'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  `);
  console.log('Found FK constraints:', JSON.stringify(constraints));

  for (const c of constraints) {
    const fkName = c.CONSTRAINT_NAME;
    console.log(`Dropping FK: ${fkName}`);
    await prisma.$executeRawUnsafe(`ALTER TABLE orders DROP FOREIGN KEY \`${fkName}\``);
  }

  // 查找并删除 unique index
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT INDEX_NAME 
    FROM information_schema.STATISTICS 
    WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'task_id' 
    AND TABLE_SCHEMA = 'neighborhood_help'
    AND NON_UNIQUE = 0
  `);
  console.log('Found unique indexes:', JSON.stringify(indexes));

  for (const idx of indexes) {
    const idxName = idx.INDEX_NAME;
    if (idxName === 'PRIMARY') continue;
    console.log(`Dropping index: ${idxName}`);
    await prisma.$executeRawUnsafe(`ALTER TABLE orders DROP INDEX \`${idxName}\``);
  }

  console.log('Done. Now run: npx prisma db push');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
