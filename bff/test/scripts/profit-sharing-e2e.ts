/**
 * 端到端集成测试：验证分账规则在订单创建与支付流程中的自动计算
 *
 * 运行方式：
 *   cd d:\neighborhood-help\bff
 *   npm run test:e2e:profit-sharing
 *
 * 测试覆盖：
 *   1. 全局默认规则 (10%)
 *   2. 类别专属规则覆盖 (家政保洁 15%)
 *   3. minPlatformFee 保底价
 *   4. maxPlatformFee 封顶
 *   5. 金额四舍五入到分
 *   6. 回退到全局默认规则
 *   7. 端到端：创建任务 → 订单创建 → 支付回调 → 钱包冻结
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_PLATFORM_RATE = 0.1;
const DEFAULT_HELPER_RATE = 0.9;

// ===== 核心算法 (与 ProfitSharingService.calculate 完全一致) =====
async function calculateSharing(
  totalAmount: number,
  categoryId: bigint | null,
): Promise<{
  platformFee: number;
  helperAmount: number;
  ruleId: string;
  platformRate: number;
  helperRate: number;
}> {
  const total = Number(totalAmount);
  const now = new Date();

  let matchedRule: {
    id: bigint;
    platformRate: Prisma.Decimal;
    helperRate: Prisma.Decimal;
    minPlatformFee: Prisma.Decimal | null;
    maxPlatformFee: Prisma.Decimal | null;
  } | null = null;

  if (categoryId !== null) {
    matchedRule = await prisma.profitSharingRule.findFirst({
      where: {
        categoryId,
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gt: now } }] },
        ],
      },
      orderBy: { priority: 'desc' },
      select: {
        id: true,
        platformRate: true,
        helperRate: true,
        minPlatformFee: true,
        maxPlatformFee: true,
      },
    });
  }

  if (!matchedRule) {
    matchedRule = await prisma.profitSharingRule.findFirst({
      where: {
        categoryId: null,
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gt: now } }] },
        ],
      },
      orderBy: { priority: 'desc' },
      select: {
        id: true,
        platformRate: true,
        helperRate: true,
        minPlatformFee: true,
        maxPlatformFee: true,
      },
    });
  }

  let platformRate: number;
  let helperRate: number;
  let minPlatformFee: number | null;
  let maxPlatformFee: number | null;
  let ruleId: string;

  if (matchedRule) {
    platformRate = Number(matchedRule.platformRate);
    helperRate = Number(matchedRule.helperRate);
    minPlatformFee = matchedRule.minPlatformFee !== null ? Number(matchedRule.minPlatformFee) : null;
    maxPlatformFee = matchedRule.maxPlatformFee !== null ? Number(matchedRule.maxPlatformFee) : null;
    ruleId = matchedRule.id.toString();
  } else {
    platformRate = DEFAULT_PLATFORM_RATE;
    helperRate = DEFAULT_HELPER_RATE;
    minPlatformFee = null;
    maxPlatformFee = null;
    ruleId = 'DEFAULT';
  }

  let platformFee = total * platformRate;
  if (minPlatformFee !== null) platformFee = Math.max(platformFee, minPlatformFee);
  if (maxPlatformFee !== null) platformFee = Math.min(platformFee, maxPlatformFee);
  platformFee = Math.round(platformFee * 100) / 100;

  const helperAmount = Math.max(0, Math.round((total - platformFee) * 100) / 100);

  return { platformFee, helperAmount, ruleId, platformRate, helperRate };
}

// ===== 辅助函数 =====
function log(step: string, message: string, ok = true) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} [${step}] ${message}`);
}

function assertEqual(actual: number, expected: number, label: string) {
  if (Math.abs(actual - expected) < 0.01) {
    log(label, `${actual.toFixed(2)} === ${expected.toFixed(2)}`, true);
  } else {
    log(label, `期望 ${expected.toFixed(2)}, 实际 ${actual.toFixed(2)}`, false);
    throw new Error(`断言失败: ${label}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  分账规则端到端集成测试 (Profit Sharing E2E)');
  console.log('═══════════════════════════════════════════════════\n');

  const TEST_PREFIX = 'E2E_';
  let passedCount = 0;
  let failedCount = 0;

  function check(condition: boolean, label: string, detail: string) {
    if (condition) {
      log(label, detail, true);
      passedCount++;
    } else {
      log(label, detail, false);
      failedCount++;
    }
  }

  try {
    // ========== 准备测试用户 ==========
    console.log('━━━ 准备测试用户 ━━━');
    const PUBLISHER_ID = 999001n;
    const HELPER_ID = 999002n;

    // 清理旧测试数据（确保可重复执行）
    await prisma.transaction.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.profitSharingRule.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: [PUBLISHER_ID, HELPER_ID] } } });
    await prisma.user.deleteMany({ where: { id: { in: [PUBLISHER_ID, HELPER_ID] } } });
    log('清理', '旧测试数据已清理');

    // 创建用户
    await prisma.user.create({
      data: { id: PUBLISHER_ID, openid: 'e2e_publisher', nickname: '测试发布者', role: 'USER' },
    });
    await prisma.user.create({
      data: { id: HELPER_ID, openid: 'e2e_helper', nickname: '测试接单者', role: 'HELPER' },
    });
    // 创建钱包 (在用户之后)
    await prisma.wallet.create({ data: { userId: PUBLISHER_ID, balance: 1000, frozen: 0 } });
    await prisma.wallet.create({ data: { userId: HELPER_ID, balance: 0, frozen: 0 } });
    log('用户', `发布者(PID=${PUBLISHER_ID}), 接单者(HID=${HELPER_ID})`);

    const categories = await prisma.taskCategory.findMany({ where: { isActive: true } });
    log('类别', `${categories.length} 个活跃类别`);

    // ========== 测试 1: 全局默认规则 ==========
    console.log('\n━━━ 测试 1: 全局默认分账规则 ━━━');
    {
      const deliveryCategory = categories.find(c => c.code === 'DELIVERY')!;
      const task = await prisma.task.create({
        data: {
          publisherId: PUBLISHER_ID,
          helperId: HELPER_ID,
          title: `${TEST_PREFIX}快递`,
          description: 'E2E测试-验证全局默认分账规则正确应用',
          price: 20,
          lat: 23.1291,
          lng: 113.2644,
          geohash: 'e2etest1',
          address: '测试地址1',
          categoryId: deliveryCategory.id,
          urgency: 'NORMAL',
          status: 'ASSIGNED',
          expireAt: new Date(Date.now() + 3600000),
        },
      });

      const sharing = await calculateSharing(Number(task.price), task.categoryId);
      log('分账', `price=20, ruleId=${sharing.ruleId}, platformFee=${sharing.platformFee}, helperAmount=${sharing.helperAmount}`);

      check(sharing.platformRate === 0.1 && sharing.helperRate === 0.9, '规则命中', `匹配到全局默认规则 ${sharing.ruleId}`);
      assertEqual(sharing.platformRate, 0.1, '平台抽成比例 10%');
      assertEqual(sharing.platformFee, 2, '平台抽成 20×10% = 2元');
      assertEqual(sharing.helperAmount, 18, '接单者 20-2 = 18元');
    }

    // ========== 测试 2: 类别专属规则 ==========
    console.log('\n━━━ 测试 2: 类别专属分账规则 (家政保洁 15%) ━━━');
    {
      const cleaningCategory = categories.find(c => c.code === 'CLEANING')!;

      // 插入专属规则
      const RULE_ID = 3n;
      await prisma.profitSharingRule.upsert({
        where: { id: RULE_ID },
        update: {},
        create: {
          id: RULE_ID,
          name: `${TEST_PREFIX}家政专属`,
          categoryId: cleaningCategory.id,
          platformRate: 0.15,
          helperRate: 0.85,
          isActive: true,
          priority: 10,
        },
      });

      const task = await prisma.task.create({
        data: {
          publisherId: PUBLISHER_ID,
          helperId: HELPER_ID,
          title: `${TEST_PREFIX}保洁`,
          description: 'E2E测试-验证类别专属分账规则覆盖全局默认',
          price: 50,
          lat: 23.1291,
          lng: 113.2644,
          geohash: 'e2etest2',
          address: '测试地址2',
          categoryId: cleaningCategory.id,
          urgency: 'NORMAL',
          status: 'ASSIGNED',
          expireAt: new Date(Date.now() + 3600000),
        },
      });

      const sharing = await calculateSharing(Number(task.price), task.categoryId);
      log('分账', `price=50, ruleId=${sharing.ruleId}, platformFee=${sharing.platformFee}`);

      check(sharing.ruleId === String(RULE_ID), '规则命中', `命中专属规则 ${sharing.ruleId} (应覆盖全局)`);
      assertEqual(sharing.platformRate, 0.15, '平台抽成 15% (命中保洁专属)');
      assertEqual(sharing.platformFee, 7.5, '50×15% = 7.5元');
      assertEqual(sharing.helperAmount, 42.5, '50-7.5 = 42.5元');
    }

    // ========== 测试 3: minPlatformFee 保底 ==========
    console.log('\n━━━ 测试 3: minPlatformFee 保底价 ━━━');
    {
      const deliveryCategory = categories.find(c => c.code === 'DELIVERY')!;
      const RULE_ID = 4n;
      await prisma.profitSharingRule.upsert({
        where: { id: RULE_ID },
        update: {},
        create: {
          id: RULE_ID,
          name: `${TEST_PREFIX}跑腿保底`,
          categoryId: deliveryCategory.id,
          platformRate: 0.05,
          helperRate: 0.95,
          minPlatformFee: 5,
          isActive: true,
          priority: 5,
        },
      });

      const task = await prisma.task.create({
        data: {
          publisherId: PUBLISHER_ID,
          helperId: HELPER_ID,
          title: `${TEST_PREFIX}低价跑腿`,
          description: 'E2E测试-验证minPlatformFee保底机制正确生效',
          price: 30,
          lat: 23.1291,
          lng: 113.2644,
          geohash: 'e2etest3',
          address: '测试地址3',
          categoryId: deliveryCategory.id,
          urgency: 'NORMAL',
          status: 'ASSIGNED',
          expireAt: new Date(Date.now() + 3600000),
        },
      });

      const sharing = await calculateSharing(Number(task.price), task.categoryId);
      log('分账', `price=30, ruleId=${sharing.ruleId}, platformFee=${sharing.platformFee}`);

      check(sharing.ruleId === String(RULE_ID), '规则命中', `命中跑腿保底规则`);
      assertEqual(sharing.platformFee, 5, '30×5%=1.5 → 保底5元');
      assertEqual(sharing.helperAmount, 25, '30-5 = 25元');
    }

    // ========== 测试 4: maxPlatformFee 封顶 ==========
    console.log('\n━━━ 测试 4: maxPlatformFee 封顶 ━━━');
    {
      const tutoringCategory = categories.find(c => c.code === 'TUTORING')!;
      const RULE_ID = 5n;
      await prisma.profitSharingRule.upsert({
        where: { id: RULE_ID },
        update: {},
        create: {
          id: RULE_ID,
          name: `${TEST_PREFIX}辅导封顶`,
          categoryId: tutoringCategory.id,
          platformRate: 0.2,
          helperRate: 0.8,
          maxPlatformFee: 15,
          isActive: true,
          priority: 5,
        },
      });

      const task = await prisma.task.create({
        data: {
          publisherId: PUBLISHER_ID,
          helperId: HELPER_ID,
          title: `${TEST_PREFIX}高价辅导`,
          description: 'E2E测试-验证maxPlatformFee封顶机制正确生效',
          price: 200,
          lat: 23.1291,
          lng: 113.2644,
          geohash: 'e2etest4',
          address: '测试地址4',
          categoryId: tutoringCategory.id,
          urgency: 'NORMAL',
          status: 'ASSIGNED',
          expireAt: new Date(Date.now() + 3600000),
        },
      });

      const sharing = await calculateSharing(Number(task.price), task.categoryId);
      log('分账', `price=200, ruleId=${sharing.ruleId}, platformFee=${sharing.platformFee}`);

      check(sharing.ruleId === String(RULE_ID), '规则命中', `命中辅导封顶规则`);
      assertEqual(sharing.platformFee, 15, '200×20%=40 → 封顶15元');
      assertEqual(sharing.helperAmount, 185, '200-15 = 185元');
    }

    // ========== 测试 5: 四舍五入精度 ==========
    console.log('\n━━━ 测试 5: 金额四舍五入精度 (到分) ━━━');
    {
      const shoppingCategory = categories.find(c => c.code === 'SHOPPING')!;
      const task = await prisma.task.create({
        data: {
          publisherId: PUBLISHER_ID,
          helperId: HELPER_ID,
          title: `${TEST_PREFIX}精度`,
          description: 'E2E测试-验证分账金额正确四舍五入到分',
          price: 33.33,
          lat: 23.1291,
          lng: 113.2644,
          geohash: 'e2etest5',
          address: '测试地址5',
          categoryId: shoppingCategory.id,
          urgency: 'NORMAL',
          status: 'ASSIGNED',
          expireAt: new Date(Date.now() + 3600000),
        },
      });

      const sharing = await calculateSharing(Number(task.price), task.categoryId);
      log('分账', `price=33.33, ruleId=${sharing.ruleId}, platformFee=${sharing.platformFee}`);

      check(sharing.platformRate === 0.1, '规则命中', '回退到全局默认(10%)');
      assertEqual(sharing.platformFee, 3.33, '33.33×10%=3.333 → 四舍五入 3.33');
      assertEqual(sharing.helperAmount, 30, '33.33-3.33 = 30.00');
    }

    // ========== 测试 6: 回退到全局默认 ==========
    console.log('\n━━━ 测试 6: 回退到全局默认规则 ━━━');
    {
      const petCategory = categories.find(c => c.code === 'PET_CARE')!;
      const task = await prisma.task.create({
        data: {
          publisherId: PUBLISHER_ID,
          helperId: HELPER_ID,
          title: `${TEST_PREFIX}宠物`,
          description: 'E2E测试-验证无专属规则时回退到全局默认',
          price: 15,
          lat: 23.1291,
          lng: 113.2644,
          geohash: 'e2etest6',
          address: '测试地址6',
          categoryId: petCategory.id,
          urgency: 'NORMAL',
          status: 'ASSIGNED',
          expireAt: new Date(Date.now() + 3600000),
        },
      });

      const sharing = await calculateSharing(Number(task.price), task.categoryId);
      log('分账', `price=15, ruleId=${sharing.ruleId}, platformFee=${sharing.platformFee}`);

      check(sharing.platformRate === 0.1, '规则命中', '回退到全局默认(10%)');
      assertEqual(sharing.platformRate, 0.1, '全局默认 10%');
      assertEqual(sharing.platformFee, 1.5, '15×10% = 1.5元');
      assertEqual(sharing.helperAmount, 13.5, '15-1.5 = 13.5元');
    }

    // ========== 测试 7: 完整端到端 (创建订单 → 支付 → 验证钱包) ==========
    console.log('\n━━━ 测试 7: 完整端到端流程 ━━━');
    {
      const cleaningCategory = categories.find(c => c.code === 'CLEANING')!;
      const rule = await prisma.profitSharingRule.findFirst({
        where: { categoryId: cleaningCategory.id, isActive: true },
      });
      check(!!rule, '前置条件', '家政保洁有专属分账规则');

      // 创建任务
      const task = await prisma.task.create({
        data: {
          publisherId: PUBLISHER_ID,
          helperId: HELPER_ID,
          title: `${TEST_PREFIX}完整流程`,
          description: 'E2E测试-完整订单创建到支付流程',
          price: 100,
          lat: 23.1291,
          lng: 113.2644,
          geohash: 'e2etest7',
          address: '测试地址7',
          categoryId: cleaningCategory.id,
          urgency: 'NORMAL',
          status: 'ASSIGNED',
          expireAt: new Date(Date.now() + 3600000),
        },
      });

      // 步骤 1: PaymentService.createOrder 计算分账并创建订单
      const sharing = await calculateSharing(Number(task.price), task.categoryId);
      const order = await prisma.order.create({
        data: {
          taskId: task.id,
          helperId: task.helperId!,
          totalAmount: task.price,
          platformFee: sharing.platformFee,
          status: 'PENDING',
        },
      });
      log('订单创建', `orderId=${order.id}, totalAmount=${order.totalAmount}, platformFee=${order.platformFee}`);

      // 验证订单中的 platformFee 与分账规则一致
      const savedFee = Number(order.platformFee);
      check(
        Math.abs(savedFee - sharing.platformFee) < 0.01,
        '订单分账',
        `订单 platformFee=${savedFee} 与分账计算 ${sharing.platformFee} 一致`,
      );

      // 步骤 2: 模拟支付回调 handleNotify
      const helperWalletBefore = await prisma.wallet.findUnique({
        where: { userId: HELPER_ID },
      });
      const helperWalletId = helperWalletBefore!.id; // Wallet 自增 ID（非 userId）
      log('支付前钱包', `接单者 walletId=${helperWalletId}, frozen=${helperWalletBefore!.frozen}`);

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
        await tx.task.update({
          where: { id: task.id },
          data: { status: 'IN_PROGRESS' },
        });

        // 冻结接单者应得部分
        const freezeAmount = sharing.helperAmount;
        await tx.wallet.update({
          where: { id: helperWalletId },
          data: { frozen: { increment: freezeAmount } },
        });

        await tx.transaction.create({
          data: {
            walletId: helperWalletId,
            orderId: order.id,
            type: 'FREEZE',
            amount: freezeAmount,
            balanceAfter: 0,
            description: `任务报酬（冻结，规则 ${sharing.ruleId}）`,
          },
        });
      });

      // 验证结果
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      const updatedTask = await prisma.task.findUnique({ where: { id: task.id } });
      const helperWallet = await prisma.wallet.findUnique({ where: { userId: HELPER_ID } });
      const transactions = await prisma.transaction.findMany({
        where: { orderId: order.id },
      });

      check(updatedOrder?.status === 'PAID', '订单状态', 'PENDING → PAID');
      check(updatedTask?.status === 'IN_PROGRESS', '任务状态', 'ASSIGNED → IN_PROGRESS');

      // 钱包冻结 = helperAmount (平台抽成不入钱包)
      const expectedFrozen = sharing.helperAmount;
      const actualFrozen = Number(helperWallet!.frozen);
      check(
        Math.abs(actualFrozen - expectedFrozen) < 0.01,
        '钱包冻结',
        `接单者 frozen=${actualFrozen} (期望 ${expectedFrozen}, 已扣除平台抽成 ${sharing.platformFee})`,
      );

      // 平台抽成 = 订单 totalAmount - 接单者冻结
      check(
        Math.abs(Number(order.totalAmount) - Number(helperWallet!.frozen) - sharing.platformFee) < 0.01,
        '分账守恒',
        `totalAmount(${order.totalAmount}) = 冻结(${helperWallet!.frozen}) + 平台抽(${sharing.platformFee})`,
      );

      check(transactions.length === 1, '流水', `生成 1 条 FREEZE 流水 (type=${transactions[0].type})`);

      log('验证', '✅ 测试 7 通过：完整端到端流程');
    }

    // ========== 测试 8: 金额守恒性验证 (多场景) ==========
    console.log('\n━━━ 测试 8: 金额守恒性验证 ━━━');
    {
      const testCases = [
        { price: 100, categoryCode: 'CLEANING', expectedPlatform: 15, expectedHelper: 85 },
        { price: 30, categoryCode: 'DELIVERY', expectedPlatform: 5, expectedHelper: 25 },
        { price: 200, categoryCode: 'TUTORING', expectedPlatform: 15, expectedHelper: 185 },
        { price: 50, categoryCode: 'OTHER', expectedPlatform: 5, expectedHelper: 45 },
        { price: 10, categoryCode: 'MOVING', expectedPlatform: 1, expectedHelper: 9 },
      ];

      for (const tc of testCases) {
        const cat = categories.find(c => c.code === tc.categoryCode)!;
        const sharing = await calculateSharing(tc.price, cat.id);
        const conserved = Math.abs(sharing.platformFee + sharing.helperAmount - tc.price) < 0.02;
        log(`守恒[${tc.categoryCode}]`, `price=${tc.price} → platform=${sharing.platformFee} + helper=${sharing.helperAmount} = ${(sharing.platformFee + sharing.helperAmount).toFixed(2)}`, conserved);
        check(conserved, `守恒-${tc.categoryCode}`, '平台+接单者 = 总金额');
      }
    }

    // ========== 清理 ==========
    console.log('\n━━━ 清理测试数据 ━━━');
    await prisma.transaction.deleteMany({
      where: { order: { task: { title: { startsWith: TEST_PREFIX } } } },
    });
    await prisma.order.deleteMany({
      where: { task: { title: { startsWith: TEST_PREFIX } } },
    });
    await prisma.task.deleteMany({
      where: { title: { startsWith: TEST_PREFIX } },
    });
    await prisma.profitSharingRule.deleteMany({
      where: { name: { startsWith: TEST_PREFIX } },
    });
    log('清理', '测试数据已清理');

    // ========== 汇总 ==========
    console.log('\n═══════════════════════════════════════════════════');
    const total = passedCount + failedCount;
    console.log(`  测试结果: ${passedCount}/${total} 通过, ${failedCount} 失败`);
    if (failedCount === 0) {
      console.log('  🎉 所有分账规则验证通过！');
    } else {
      console.log('  ⚠️ 部分测试失败，请检查上述错误信息');
    }
    console.log('═══════════════════════════════════════════════════\n');

    // 显示当前规则
    const globalRule = await prisma.profitSharingRule.findFirst({
      where: { categoryId: null, isActive: true },
    });
    const customRules = await prisma.profitSharingRule.findMany({
      where: { categoryId: { not: null }, isActive: true },
      include: { category: true },
    });

    console.log('📋 当前生效的分账规则：');
    if (globalRule) {
      console.log(`  🌐 全局默认: 平台 ${(Number(globalRule.platformRate) * 100).toFixed(1)}% / 接单者 ${(Number(globalRule.helperRate) * 100).toFixed(1)}%`);
    }
    for (const r of customRules) {
      const range = [r.minPlatformFee, r.maxPlatformFee].some(v => v !== null)
        ? ` (${r.minPlatformFee ?? '0'}~${r.maxPlatformFee ?? '∞'}元)`
        : '';
      console.log(`  📂 ${r.category?.name || '未知'}: 平台 ${(Number(r.platformRate) * 100).toFixed(1)}% / 接单者 ${(Number(r.helperRate) * 100).toFixed(1)}%${range}`);
    }

    await prisma.$disconnect();

    if (failedCount > 0) process.exit(1);
  } catch (err) {
    console.error('❌ 测试脚本执行失败:', (err as Error).message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
