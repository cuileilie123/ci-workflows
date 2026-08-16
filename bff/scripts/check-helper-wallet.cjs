/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const w = await prisma.wallet.findUnique({
    where: { userId: 999005n },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
  });
  if (!w) { console.log('no wallet'); return; }
  console.log(`Helper wallet: balance=¥${w.balance} frozen=¥${w.frozen}`);
  for (const t of w.transactions) {
    console.log(`  ${t.type} ¥${t.amount} | ${t.description}`);
  }
  await prisma.$disconnect();
}
main();
