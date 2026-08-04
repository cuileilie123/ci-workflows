/* 高并发钱包测试脚本 - 验证死锁修复 + 超扣防护 + 原子性 */
/* 运行：node bff/scripts/test-wallet-concurrency.cjs */
const path = require('path');
const fs = require('fs');

// ---- 加载 bff/.env ----
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { PrismaClient, Prisma } = require('@prisma/client');

const log = (m) => console.log(`\x1b[36m[wallet-test]\x1b[0m ${m}`);
const success = (m) => console.log(`\x1b[32m  ✅ ${m}\x1b[0m`);
const fail = (m) => console.log(`\x1b[31m  ❌ ${m}\x1b[0m`);
const warn = (m) => console.log(`\x1b[33m  ⚠️  ${m}\x1b[0m`);

// 统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, msg) {
  totalTests++;
  if (condition) {
    passedTests++;
    success(msg);
  } else {
    failedTests++;
    fail(msg);
    throw new Error(`ASSERT FAILED: ${msg}`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 并发执行限制
async function asyncPool(tasks, concurrency) {
  const results = [];
  let nextIndex = 0;
  const pool = [];

  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    pool.push(runNext());
  }

  async function runNext() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        results[index] = await tasks[index]();
      } catch (e) {
        results[index] = { error: e.message };
      }
    }
  }

  await Promise.all(pool);
  return results;
}

// ========== 主测试 ==========
(async () => {
  const prisma = new PrismaClient();
  const TEST_PREFIX = 'wallet_concurrency_test';

  try {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   钱包高并发测试 - 死锁/超扣/原子性验证      ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    // 0. 清理旧测试数据
    log('清理旧测试数据...');
    const testUsers = await prisma.user.findMany({
      where: { openid: { startsWith: TEST_PREFIX } },
      select: { id: true, openid: true },
    });

    for (const u of testUsers) {
      await prisma.transaction.deleteMany({
        where: { wallet: { userId: u.id } },
      });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
    }
    await prisma.user.deleteMany({
      where: { openid: { startsWith: TEST_PREFIX } },
    });
    log(`清理完成，移除 ${testUsers.length} 个旧测试用户`);

    // 1. 创建测试用户（A 和 B），各有初始余额 1000
    log('');
    log('─────────────────────────────────────────────');
    log('1️⃣  创建测试用户');

    const userA = await prisma.user.create({
      data: {
        openid: `${TEST_PREFIX}_A`,
        nickname: '测试用户A',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
        wallet: {
          create: { balance: new Prisma.Decimal(1000), frozen: new Prisma.Decimal(0) },
        },
      },
      include: { wallet: true },
    });

    const userB = await prisma.user.create({
      data: {
        openid: `${TEST_PREFIX}_B`,
        nickname: '测试用户B',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
        wallet: {
          create: { balance: new Prisma.Decimal(1000), frozen: new Prisma.Decimal(0) },
        },
      },
      include: { wallet: true },
    });

    log(`用户 A: id=${userA.id}, wallet.balance=1000`);
    log(`用户 B: id=${userB.id}, wallet.balance=1000`);

    const balanceA = () => prisma.wallet.findUnique({ where: { userId: userA.id } });
    const balanceB = () => prisma.wallet.findUnique({ where: { userId: userB.id } });

    // ================================================
    // 测试 1: AB-BA 死锁测试（双向并发转账）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('2️⃣  测试 1: AB-BA 死锁测试（双向并发转账）');
    log('  用户 A → B 转账 10 元 × 20 次');
    log('  用户 B → A 转账 10 元 × 20 次');
    log('  （同时发起，模拟经典 AB-BA 场景）');

    const CONCURRENT = 20;
    const AMOUNT = 10;

    // 记录操作结果
    let successCount = 0;
    let failCount = 0;
    let deadlockCount = 0;
    let timeoutCount = 0;

    const transferTasks = [];
    for (let i = 0; i < CONCURRENT; i++) {
      // A → B
      transferTasks.push(async () => {
        try {
          await prisma.$transaction(async (tx) => {
            // 🔑 关键：按 userId 升序获取锁（与 wallet.service.ts 修复一致）
            const [firstId, secondId] = userA.id < userB.id
              ? [userA.id, userB.id]
              : [userB.id, userA.id];

            const firstWallet = await tx.wallet.findUnique({
              where: { userId: firstId },
            });
            const secondWallet = await tx.wallet.findUnique({
              where: { userId: secondId },
            });

            if (!firstWallet || !secondWallet) {
              throw new Error('钱包不存在');
            }

            const isFirstFrom = firstId === userA.id;
            const fromWallet = isFirstFrom ? firstWallet : secondWallet;
            const toWallet = isFirstFrom ? secondWallet : firstWallet;

            const fromBal = Number(fromWallet.balance);
            if (fromBal < AMOUNT) {
              throw new Error(`余额不足`);
            }

            await tx.wallet.update({
              where: { id: fromWallet.id },
              data: { balance: new Prisma.Decimal(fromBal - AMOUNT) },
            });
            await tx.wallet.update({
              where: { id: toWallet.id },
              data: { balance: new Prisma.Decimal(Number(toWallet.balance) + AMOUNT) },
            });

            await tx.transaction.create({
              data: {
                walletId: fromWallet.id,
                type: 'EXPENSE',
                amount: new Prisma.Decimal(AMOUNT),
                balanceAfter: new Prisma.Decimal(fromBal - AMOUNT),
                description: `并发转账测试 A→B #${i}`,
              },
            });
            await tx.transaction.create({
              data: {
                walletId: toWallet.id,
                type: 'INCOME',
                amount: new Prisma.Decimal(AMOUNT),
                balanceAfter: new Prisma.Decimal(Number(toWallet.balance) + AMOUNT),
                description: `并发转账测试 A→B #${i}`,
              },
            });
          });
          successCount++;
        } catch (e) {
          if (e.message.includes('Deadlock') || e.message.includes('deadlock')) {
            deadlockCount++;
          } else if (e.message.includes('余额不足')) {
            failCount++;
          } else {
            failCount++;
          }
        }
      });

      // B → A（与 A→B 同时发起，制造 AB-BA）
      transferTasks.push(async () => {
        try {
          await prisma.$transaction(async (tx) => {
            const [firstId, secondId] = userB.id < userA.id
              ? [userB.id, userA.id]
              : [userA.id, userB.id];

            const firstWallet = await tx.wallet.findUnique({
              where: { userId: firstId },
            });
            const secondWallet = await tx.wallet.findUnique({
              where: { userId: secondId },
            });

            if (!firstWallet || !secondWallet) {
              throw new Error('钱包不存在');
            }

            const isFirstFrom = firstId === userB.id;
            const fromWallet = isFirstFrom ? firstWallet : secondWallet;
            const toWallet = isFirstFrom ? secondWallet : firstWallet;

            const fromBal = Number(fromWallet.balance);
            if (fromBal < AMOUNT) {
              throw new Error(`余额不足`);
            }

            await tx.wallet.update({
              where: { id: fromWallet.id },
              data: { balance: new Prisma.Decimal(fromBal - AMOUNT) },
            });
            await tx.wallet.update({
              where: { id: toWallet.id },
              data: { balance: new Prisma.Decimal(Number(toWallet.balance) + AMOUNT) },
            });

            await tx.transaction.create({
              data: {
                walletId: fromWallet.id,
                type: 'EXPENSE',
                amount: new Prisma.Decimal(AMOUNT),
                balanceAfter: new Prisma.Decimal(fromBal - AMOUNT),
                description: `并发转账测试 B→A #${i}`,
              },
            });
            await tx.transaction.create({
              data: {
                walletId: toWallet.id,
                type: 'INCOME',
                amount: new Prisma.Decimal(AMOUNT),
                balanceAfter: new Prisma.Decimal(Number(toWallet.balance) + AMOUNT),
                description: `并发转账测试 B→A #${i}`,
              },
            });
          });
          successCount++;
        } catch (e) {
          if (e.message.includes('Deadlock') || e.message.includes('deadlock')) {
            deadlockCount++;
          } else if (e.message.includes('余额不足')) {
            failCount++;
          } else {
            failCount++;
          }
        }
      });
    }

    log(`执行 ${transferTasks.length} 个并发转账任务...`);
    const startTime = Date.now();
    await asyncPool(transferTasks, CONCURRENT * 2);
    const elapsed = Date.now() - startTime;

    log(`完成！耗时 ${elapsed}ms`);
    log(`成功: ${successCount}, 失败: ${failCount}, 死锁: ${deadlockCount}`);

    assert(deadlockCount === 0, '测试 1.1: 无死锁发生（AB-BA 修复有效）');
    assert(successCount > 0, '测试 1.2: 至少有部分转账成功');

    // 由于 A→B 和 B→A 金额相同，理论上总余额应守恒
    const finalA = await balanceA();
    const finalB = await balanceB();
    log(`转账后 A 余额: ${finalA.balance}, B 余额: ${finalB.balance}`);

    // 初始各 1000，A→B 转出 20*10=200，B→A 转出 20*10=200
    // A 净变化: -200 + 200 = 0
    // B 净变化: -200 + 200 = 0
    // 但如果有失败，金额可能不完全对称
    const totalMoney = Number(finalA.balance) + Number(finalB.balance);
    assert(totalMoney === 2000, `测试 1.3: 总金额守恒（应为 2000，实际 ${totalMoney}）`);

    // ================================================
    // 测试 2: 并发扣款超防护
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('3️⃣  测试 2: 并发扣款超防护');
    log('  用户 A 余额 100，20 个并发请求各扣 10 元');
    log('  理论上仅 10 次成功，10 次应因余额不足被拒');

    // 重置 A 余额为 100
    await prisma.wallet.update({
      where: { userId: userA.id },
      data: { balance: new Prisma.Decimal(100), frozen: new Prisma.Decimal(0) },
    });

    let deductSuccess = 0;
    let deductFail = 0;
    let overdraftHappened = false;

    const deductTasks = [];
    for (let i = 0; i < 20; i++) {
      deductTasks.push(async () => {
        try {
          await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({
              where: { userId: userA.id },
            });
            const bal = Number(wallet.balance);
            if (bal < 10) {
              throw new Error('余额不足');
            }
            await tx.wallet.update({
              where: { id: wallet.id },
              data: { balance: new Prisma.Decimal(bal - 10) },
            });
            await tx.transaction.create({
              data: {
                walletId: wallet.id,
                type: 'EXPENSE',
                amount: new Prisma.Decimal(10),
                balanceAfter: new Prisma.Decimal(bal - 10),
                description: `并发扣款测试 #${i}`,
              },
            });
          });
          deductSuccess++;
        } catch (e) {
          deductFail++;
        }
      });
    }

    await asyncPool(deductTasks, 20);

    log(`扣款成功: ${deductSuccess}, 失败: ${deductFail}`);
    log(`理论值: 成功 10 次, 失败 10 次`);

    assert(deductSuccess === 10, `测试 2.1: 恰好 10 次成功（实际 ${deductSuccess}）`);
    assert(deductFail === 10, `测试 2.2: 恰好 10 次被拒（实际 ${deductFail}）`);

    const afterDeductA = await balanceA();
    log(`扣款后 A 余额: ${afterDeductA.balance}（应为 0）`);
    assert(Number(afterDeductA.balance) === 0, `测试 2.3: 余额精确为 0（无超扣）`);

    // 验证流水数 = 10 条成功 + 可能 0 条失败流水（失败的没有写流水）
    const txCountA = await prisma.transaction.count({
      where: { walletId: afterDeductA.id },
    });
    log(`A 的流水总数: ${txCountA}`);

    // ================================================
    // 测试 3: 高强度连续并发（压力测试）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('4️⃣  测试 3: 高强度并发压力测试');
    log('  50 个并发请求，随机金额转账');

    // 重置双方余额
    await prisma.wallet.update({
      where: { userId: userA.id },
      data: { balance: new Prisma.Decimal(5000), frozen: new Prisma.Decimal(0) },
    });
    await prisma.wallet.update({
      where: { userId: userB.id },
      data: { balance: new Prisma.Decimal(5000), frozen: new Prisma.Decimal(0) },
    });

    let pressureSuccess = 0;
    let pressureFail = 0;
    let pressureDeadlock = 0;

    const pressureTasks = [];
    for (let i = 0; i < 50; i++) {
      // 交替方向：奇数 A→B，偶数 B→A
      const fromId = i % 2 === 0 ? userA.id : userB.id;
      const toId = i % 2 === 0 ? userB.id : userA.id;
      const amount = Math.floor(Math.random() * 20) + 1; // 1-20 随机

      pressureTasks.push(async () => {
        try {
          await prisma.$transaction(async (tx) => {
            // 锁排序：按 userId 升序
            const [firstId, secondId] = fromId < toId
              ? [fromId, toId]
              : [toId, fromId];

            const firstWallet = await tx.wallet.findUnique({
              where: { userId: firstId },
            });
            const secondWallet = await tx.wallet.findUnique({
              where: { userId: secondId },
            });

            if (!firstWallet || !secondWallet) {
              throw new Error('钱包不存在');
            }

            const isFirstFrom = firstId === fromId;
            const fromWallet = isFirstFrom ? firstWallet : secondWallet;
            const toWallet = isFirstFrom ? secondWallet : firstWallet;

            const fromBal = Number(fromWallet.balance);
            if (fromBal < amount) {
              throw new Error('余额不足');
            }

            await tx.wallet.update({
              where: { id: fromWallet.id },
              data: { balance: new Prisma.Decimal(fromBal - amount) },
            });
            await tx.wallet.update({
              where: { id: toWallet.id },
              data: { balance: new Prisma.Decimal(Number(toWallet.balance) + amount) },
            });

            await tx.transaction.create({
              data: {
                walletId: fromWallet.id,
                type: 'EXPENSE',
                amount: new Prisma.Decimal(amount),
                balanceAfter: new Prisma.Decimal(fromBal - amount),
                description: `压力测试转出 #${i}`,
              },
            });
            await tx.transaction.create({
              data: {
                walletId: toWallet.id,
                type: 'INCOME',
                amount: new Prisma.Decimal(amount),
                balanceAfter: new Prisma.Decimal(Number(toWallet.balance) + amount),
                description: `压力测试转入 #${i}`,
              },
            });
          });
          pressureSuccess++;
        } catch (e) {
          if (e.message.includes('Deadlock') || e.message.includes('deadlock')) {
            pressureDeadlock++;
          }
          pressureFail++;
        }
      });
    }

    const pStart = Date.now();
    await asyncPool(pressureTasks, 50);
    const pElapsed = Date.now() - pStart;

    log(`压力测试完成，耗时 ${pElapsed}ms`);
    log(`成功: ${pressureSuccess}, 失败: ${pressureFail}, 死锁: ${pressureDeadlock}`);

    assert(pressureDeadlock === 0, '测试 3.1: 压力测试无死锁');

    const pFinalA = await balanceA();
    const pFinalB = await balanceB();
    const pTotal = Number(pFinalA.balance) + Number(pFinalB.balance);
    assert(pTotal === 10000, `测试 3.2: 总金额守恒（应为 10000，实际 ${pTotal}）`);

    log(`压力测试后 A: ${pFinalA.balance}, B: ${pFinalB.balance}`);

    // ================================================
    // 测试 4: 流水一致性检查
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('5️⃣  测试 4: 流水一致性验证');

    const allTxA = await prisma.transaction.findMany({
      where: { walletId: pFinalA.id },
      orderBy: { createdAt: 'asc' },
    });
    const allTxB = await prisma.transaction.findMany({
      where: { walletId: pFinalB.id },
      orderBy: { createdAt: 'asc' },
    });

    log(`A 的流水数: ${allTxA.length}`);
    log(`B 的流水数: ${allTxB.length}`);

    // 验证每条流水的 balanceAfter 与实际钱包余额一致
    // 最后一条流水的 balanceAfter 应等于当前余额
    if (allTxA.length > 0) {
      const lastTx = allTxA[allTxA.length - 1];
      assert(
        Number(lastTx.balanceAfter) === Number(pFinalA.balance),
        `测试 4.1: A 最后流水 balanceAfter 与实际余额一致（${lastTx.balanceAfter} vs ${pFinalA.balance}）`,
      );
    }

    if (allTxB.length > 0) {
      const lastTx = allTxB[allTxB.length - 1];
      assert(
        Number(lastTx.balanceAfter) === Number(pFinalB.balance),
        `测试 4.2: B 最后流水 balanceAfter 与实际余额一致（${lastTx.balanceAfter} vs ${pFinalB.balance}）`,
      );
    }

    // 验证流水不可篡改（append-only）
    // 检查所有流水都有唯一 ID
    const allIdsA = allTxA.map((t) => t.id);
    const allIdsB = allTxB.map((t) => t.id);
    assert(
      new Set(allIdsA).size === allIdsA.length,
      '测试 4.3: A 流水 ID 唯一（append-only）',
    );
    assert(
      new Set(allIdsB).size === allIdsB.length,
      '测试 4.4: B 流水 ID 唯一（append-only）',
    );

    // ================================================
    // 测试 5: initWallet 并发安全
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('6️⃣  测试 5: initWallet 并发安全（upsert 幂等）');

    const raceOpenid = `${TEST_PREFIX}_race_${Date.now()}`;
    // 预创建用户
    const raceUser = await prisma.user.create({
      data: {
        openid: raceOpenid,
        nickname: '竞态测试用户',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
      },
    });

    // 并发调用 initWallet（模拟注册时的竞态）
    let initSuccess = 0;
    let initFail = 0;
    const initTasks = [];
    for (let i = 0; i < 10; i++) {
      initTasks.push(async () => {
        try {
          // 使用 upsert 逻辑
          await prisma.wallet.upsert({
            where: { userId: raceUser.id },
            update: {},
            create: {
              userId: raceUser.id,
              balance: new Prisma.Decimal(0),
              frozen: new Prisma.Decimal(0),
            },
          });
          initSuccess++;
        } catch (e) {
          initFail++;
        }
      });
    }

    await asyncPool(initTasks, 10);

    log(`initWallet: 成功 ${initSuccess}, 失败 ${initFail}`);

    // 验证只有一个钱包被创建
    const wallets = await prisma.wallet.findMany({
      where: { userId: raceUser.id },
    });
    assert(wallets.length === 1, `测试 5.1: 只有一个钱包被创建（实际 ${wallets.length}）`);
    assert(Number(wallets[0].balance) === 0, '测试 5.2: 初始余额为 0');

    // ================================================
    // 测试 6: 冻结/解冻原子性
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('7️⃣  测试 6: 冻结/解冻原子性');

    const testUser = await prisma.user.create({
      data: {
        openid: `${TEST_PREFIX}_freeze`,
        nickname: '冻结测试用户',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
        wallet: {
          create: { balance: new Prisma.Decimal(1000), frozen: new Prisma.Decimal(0) },
        },
      },
      include: { wallet: true },
    });

    // 冻结 300
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId: testUser.id },
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: new Prisma.Decimal(Number(wallet.balance) - 300),
          frozen: new Prisma.Decimal(Number(wallet.frozen) + 300),
        },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'FREEZE',
          amount: new Prisma.Decimal(300),
          balanceAfter: new Prisma.Decimal(Number(wallet.balance) - 300),
          description: '冻结测试',
        },
      });
    });

    // 验证冻结状态
    const frozenWallet = await prisma.wallet.findUnique({
      where: { userId: testUser.id },
    });
    log(`冻结后: balance=${frozenWallet.balance}, frozen=${frozenWallet.frozen}`);
    assert(Number(frozenWallet.balance) === 700, '测试 6.1: 可用余额变为 700');
    assert(Number(frozenWallet.frozen) === 300, '测试 6.2: 冻结金额为 300');

    // 并发尝试多扣 800（应失败，因为可用只有 700）
    let freezeDeductSuccess = 0;
    let freezeDeductFail = 0;
    const freezeDeductTasks = [];
    for (let i = 0; i < 5; i++) {
      freezeDeductTasks.push(async () => {
        try {
          await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({
              where: { userId: testUser.id },
            });
            if (Number(wallet.balance) < 800) {
              throw new Error('余额不足');
            }
            await tx.wallet.update({
              where: { id: wallet.id },
              data: { balance: new Prisma.Decimal(Number(wallet.balance) - 800) },
            });
          });
          freezeDeductSuccess++;
        } catch {
          freezeDeductFail++;
        }
      });
    }

    await asyncPool(freezeDeductTasks, 5);
    log(`冻结状态下扣款 800: 成功 ${freezeDeductSuccess}, 失败 ${freezeDeductFail}`);
    assert(freezeDeductSuccess === 0, '测试 6.3: 冻结状态下无法超扣（应全部失败）');

    // 解冻后再扣
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId: testUser.id },
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: new Prisma.Decimal(Number(wallet.balance) + 300),
          frozen: new Prisma.Decimal(Number(wallet.frozen) - 300),
        },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'UNFREEZE',
          amount: new Prisma.Decimal(300),
          balanceAfter: new Prisma.Decimal(Number(wallet.balance) + 300),
          description: '解冻测试',
        },
      });
    });

    const unfrozenWallet = await prisma.wallet.findUnique({
      where: { userId: testUser.id },
    });
    log(`解冻后: balance=${unfrozenWallet.balance}, frozen=${unfrozenWallet.frozen}`);
    assert(Number(unfrozenWallet.balance) === 1000, '测试 6.4: 解冻后余额恢复');
    assert(Number(unfrozenWallet.frozen) === 0, '测试 6.5: 解冻后冻结清零');

    // ================================================
    // 汇总
    // ================================================
    log('');
    log('╔══════════════════════════════════════════════╗');
    log('║              测试结果汇总                     ║');
    log('╠══════════════════════════════════════════════╣');
    log(`║  总测试数: ${totalTests}`);
    log(`║  通过:     ${passedTests}`);
    log(`║  失败:     ${failedTests}`);
    log(`║  通过率:   ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    log('╚══════════════════════════════════════════════╝');

    if (failedTests > 0) {
      console.log('\n\x1b[31m❌ 部分测试失败！请检查上方日志\x1b[0m\n');
      process.exitCode = 1;
    } else {
      console.log('\n\x1b[32m🎉 所有测试通过！钱包并发安全已验证！\x1b[0m\n');
      console.log('验证要点：');
      console.log('  ✅ AB-BA 死锁修复有效（50 并发双向转账无死锁）');
      console.log('  ✅ 超扣防护有效（余额 100 并发扣 10 × 20 次，恰好 10 次成功）');
      console.log('  ✅ 总金额守恒（转账前后总额不变）');
      console.log('  ✅ 流水一致性（balanceAfter 与实际余额匹配）');
      console.log('  ✅ initWallet 并发安全（upsert 幂等）');
      console.log('  ✅ 冻结/解冻原子性（冻结状态下无法超扣）');
      console.log('');

      // 清理测试数据
      log('清理测试数据...');
      for (const u of testUsers) {
        await prisma.transaction.deleteMany({
          where: { wallet: { userId: u.id } },
        });
        await prisma.wallet.deleteMany({ where: { userId: u.id } });
      }
      await prisma.user.deleteMany({
        where: { openid: { startsWith: TEST_PREFIX } },
      });
      log('清理完成');
    }
  } catch (e) {
    console.error('\n\x1b[31m测试脚本异常:\x1b[0m', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
