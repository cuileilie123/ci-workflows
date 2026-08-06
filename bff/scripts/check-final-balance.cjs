/* 运行完 AB-BA 转账后用：
 *   - 校验双方钱包余额总和 = 2 * 初始值（10000 * 2 = 20000）
 *   - 校验双方流水 EXPENSE / INCOME 成对（数量相等、金额一致）
 *   - 校验双方最后一条流水的 balanceAfter 与 wallets.balance 相等
 * 用法：
 *   # 直接用之前创建的 openid 定位：
 *   node scripts/check-final-balance.cjs [expectedInitialEach=10000]
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const TEST_PREFIX = 'abba_lock_fix_test';
const OPENID_A = `${TEST_PREFIX}_userA`;
const OPENID_B = `${TEST_PREFIX}_userB`;
const INITIAL_EACH = Number(process.argv[2] || 10000);

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

(async () => {
  const prisma = new PrismaClient();
  try {
    const a = await prisma.user.findUnique({
      where: { openid: OPENID_A },
      include: { wallet: true },
    });
    const b = await prisma.user.findUnique({
      where: { openid: OPENID_B },
      include: { wallet: true },
    });
    if (!a || !a.wallet || !b || !b.wallet) {
      console.log(`${RED}❌ 测试用户不存在，请先执行 setup-abba-test-data.cjs${RESET}`);
      process.exitCode = 2;
      return;
    }

    const balA = Number(a.wallet.balance);
    const balB = Number(b.wallet.balance);
    const sum = balA + balB;
    const expected = 2 * INITIAL_EACH;

    console.log('');
    console.log('======== AB-BA 转账后 余额/流水校验 ========');
    console.log(`用户A  userId=${a.id}  余额=${balA.toFixed(2)}`);
    console.log(`用户B  userId=${b.id}  余额=${balB.toFixed(2)}`);
    console.log(`双方合计 = ${sum.toFixed(2)}  预期 = ${expected.toFixed(2)}`);

    const checks = [];
    const check = (pass, label, got, expected2) => {
      checks.push(pass);
      const line =
        (pass ? `${GREEN}✅${RESET} ` : `${RED}❌${RESET} `) +
        label +
        (got !== undefined ? `  实际=${got}` : '') +
        (expected2 !== undefined ? `  预期=${expected2}` : '');
      console.log(line);
    };

    check(sum === expected, '总金额守恒（A+B 转账前后总额不变）', sum.toFixed(2), expected.toFixed(2));

    const txs = (u) =>
      prisma.transaction.findMany({
        where: { walletId: u.wallet.id },
        orderBy: { createdAt: 'asc' },
      });
    const txA = await txs(a);
    const txB = await txs(b);
    console.log(`流水数量：A=${txA.length}  B=${txB.length}`);

    // A 的 EXPENSE 次数应当等于 B 的 INCOME 次数（且每条金额能对上），反之亦然
    const expA = txA.filter((t) => t.type === 'EXPENSE');
    const incB = txB.filter((t) => t.type === 'INCOME');
    const expB = txB.filter((t) => t.type === 'EXPENSE');
    const incA = txA.filter((t) => t.type === 'INCOME');

    check(
      expA.length === incB.length,
      'A 的 EXPENSE 与 B 的 INCOME 成对（单向转账不丢流水）',
      `${expA.length} vs ${incB.length}`,
    );
    check(
      expB.length === incA.length,
      'B 的 EXPENSE 与 A 的 INCOME 成对（反向转账不丢流水）',
      `${expB.length} vs ${incA.length}`,
    );

    const sumMoney = (arr) => arr.reduce((s, t) => s + Number(t.amount), 0);
    const sumExpA = sumMoney(expA);
    const sumIncB = sumMoney(incB);
    const sumExpB = sumMoney(expB);
    const sumIncA = sumMoney(incA);

    check(
      Math.abs(sumExpA - sumIncB) < 0.001,
      'A 转出总金额 与 B 转入总金额 一致',
      `${sumExpA.toFixed(2)} vs ${sumIncB.toFixed(2)}`,
    );
    check(
      Math.abs(sumExpB - sumIncA) < 0.001,
      'B 转出总金额 与 A 转入总金额 一致',
      `${sumExpB.toFixed(2)} vs ${sumIncA.toFixed(2)}`,
    );

    if (txA.length > 0) {
      const last = txA[txA.length - 1];
      check(
        Math.abs(Number(last.balanceAfter) - balA) < 0.001,
        'A 最后一条流水 balanceAfter 与钱包余额一致',
        `${Number(last.balanceAfter).toFixed(2)} vs ${balA.toFixed(2)}`,
      );
    }
    if (txB.length > 0) {
      const last = txB[txB.length - 1];
      check(
        Math.abs(Number(last.balanceAfter) - balB) < 0.001,
        'B 最后一条流水 balanceAfter 与钱包余额一致',
        `${Number(last.balanceAfter).toFixed(2)} vs ${balB.toFixed(2)}`,
      );
    }

    console.log('');
    if (checks.every(Boolean)) {
      console.log(
        `${GREEN}🎉 AB-BA 修复验证通过：无超扣、无丢流水、总金额守恒、无死锁（看应用日志中 LOCK-1/2 永远先锁小 userId → 再锁大 userId）${RESET}`,
      );
    } else {
      console.log(
        `${RED}💥 校验项未全部通过，请检查 wallet.service.ts 加锁顺序 / UPDATE 顺序是否严格「先 firstId → 再 secondId」${RESET}`,
      );
      process.exitCode = 1;
    }
    console.log('');
    console.log(
      `${YELLOW}💡 观察应用日志中关键行（配合刚加的 logger.info）：${RESET}`,
    );
    console.log('   - 🔁[XFR-xxx] [SORT-KEY]  —— 打印加锁顺序与转账方向是否反向');
    console.log('   - 🔒[XFR-xxx] [LOCK-1/2]   —— 拿到 firstId（小userId）行锁');
    console.log('   - 🔒[XFR-xxx] [LOCK-2/2]   —— 拿到 secondId（大userId）行锁');
    console.log('   - [UPDATE-1/2] / [UPDATE-2/2] —— 更新顺序与加锁顺序一致');
    console.log(
      '   如果两个方向请求（A→B 与 B→A）的日志发生交错但永远先锁 id 较小那方 → 修复生效，不会出现 AB-BA 交叉持锁。',
    );
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
})();
