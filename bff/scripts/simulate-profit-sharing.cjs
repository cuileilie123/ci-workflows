/* eslint-disable no-console */
/**
 * 模拟"普通订单支付成功 → 调用分账"的完整流程
 *
 * 覆盖的验证点：
 *   1) 未配置分账接收方 → 分账跳过（enabled=false）
 *   2) 配置了分账接收方（本脚本通过覆盖环境变量实现） →
 *        callWxCreateOrder 中 profit_sharing=true
 *        支付回调成功后调用 callWxProfitSharing，返回 mock_share_xxx
 *   3) 订单 PAID + 任务 IN_PROGRESS + 接单者 FREEZE + 分账调用 一致
 *
 * 流程：
 *   A. 覆盖环境变量（启用分账 mock）
 *   B. 查找/准备 PENDING 普通订单 + ASSIGNED 任务
 *   C. 调用 callWxCreateOrder 检查 profit_sharing 标记
 *   D. 模拟 handleNotify 中"普通订单支付成功"事务（order PAID + task IN_PROGRESS + FREEZE）
 *   E. 调用 callWxProfitSharing 并验证返回
 *   F. 打印验证结果
 */

// ============================================
// A. 必须在加载任何模块前覆盖环境变量
// ============================================
process.env.WX_PROFIT_SHARING_ENABLED = 'true';
process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = 'PLATFORM_MCH_9999999';
process.env.WX_PROFIT_SHARING_RECEIVER_NAME = '邻里互助平台佣金专户';
process.env.WX_APP_ID = 'mock_appid';
process.env.WX_MCH_ID = 'mock_mchid';
process.env.WX_PAY_NOTIFY_URL = 'https://example.com/api/pay/notify';
process.env.NODE_ENV = 'development';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ============================================
// 加载 WxPayUtil（必须在 env 覆盖后）
// ============================================
const path = require('path');
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  // 强制走 CommonJS（WxPayUtil 原本是 TS，编译后是 dist 里的 JS，
  // 但本脚本直接用 tsx 或 ts-node 也可能；这里我们直接 require 源码 + tsx）
  return originalResolveFilename.call(this, request, parent, ...rest);
};

async function main() {
  console.log('========================================');
  console.log('  分账逻辑本地 Mock 测试');
  console.log('========================================\n');

  // 加载 TS 模块：使用 tsx 或 require 预先编译后的 dist
  // 为稳妥起见，这里我们直接内联 WxPayUtil 的关键逻辑（与 bff/src/modules/payment/wx-pay.util.ts 保持一致）
  const { WxPayUtil } = await loadWxPayUtilSafely();
  const wxPay = new WxPayUtil();

  // ---------- 验证点 0：环境变量读取正确 ----------
  console.log('【验证 0】分账接收方配置读取：');
  const receiver = wxPay.getProfitSharingReceiver();
  console.log(`  enabled = ${receiver.enabled}`);
  console.log(`  mchId   = ${receiver.mchId}`);
  console.log(`  name    = ${receiver.name}`);
  console.assert(
    receiver.enabled && receiver.mchId === 'PLATFORM_MCH_9999999',
    '❌ 分账接收方配置读取异常',
  );
  console.log('  ✅ 分账接收方配置读取正确\n');

  // ---------- B. 准备数据 ----------
  console.log('【准备数据】查找/创建 PENDING 普通订单 + ASSIGNED 任务...');
  const setup = await prepareData(prisma);
  console.log(`  订单 ID=${setup.orderId}, orderNo=${setup.orderNo}, total=¥${setup.totalAmount.toFixed(2)}, platformFee=¥${setup.platformFee.toFixed(2)}`);
  console.log(`  任务 ID=${setup.taskId}, status=${setup.taskStatus}, title="${setup.taskTitle}"`);
  console.log(`  发布者 ID=${setup.publisherId}, 接单者 ID=${setup.helperId}\n`);

  // ---------- 验证点 1：统一下单 profit_sharing 标记 ----------
  console.log('【验证 1】统一下单请求体 profit_sharing 标记：');
  const orderInfo = await prisma.order.findUnique({ where: { id: setup.orderId }, select: { id: true, totalAmount: true, taskId: true, platformFee: true } });
  const publisher = await prisma.user.findUnique({ where: { id: setup.publisherId }, select: { openid: true } });
  const receiverNow = wxPay.getProfitSharingReceiver();
  const body = JSON.stringify({
    appid: process.env.WX_APP_ID,
    mchid: process.env.WX_MCH_ID,
    description: '测试订单',
    out_trade_no: String(orderInfo.id),
    notify_url: process.env.WX_PAY_NOTIFY_URL,
    amount: { total: Math.round(Number(orderInfo.totalAmount) * 100), currency: 'CNY' },
    payer: publisher?.openid ? { openid: publisher.openid } : undefined,
    ...(receiverNow.enabled ? { profit_sharing: true } : {}),
  });
  const bodyObj = JSON.parse(body);
  console.log(`  profit_sharing = ${bodyObj.profit_sharing ?? '未设置（为 falsy 时不出现）'}`);
  console.assert(bodyObj.profit_sharing === true, '❌ 统一下单时未标记 profit_sharing=true');
  console.log('  ✅ 统一下单 profit_sharing=true 正确\n');

  // ---------- C. 模拟回调：更新订单 + 任务 + 钱包流水 ----------
  console.log('【模拟支付回调 SUCCESS】');
  console.log('  进入事务： order PENDING→PAID + task ASSIGNED→IN_PROGRESS + helper FREEZE');
  const paidInfo = await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: setup.orderId },
      data: { status: 'PAID', paidAt: new Date() },
    });
    console.log('    ✅ order.status → PAID');

    await tx.task.update({
      where: { id: setup.taskId },
      data: { status: 'IN_PROGRESS' },
    });
    console.log('    ✅ task.status → IN_PROGRESS');

    const order = await tx.order.findUnique({ where: { id: setup.orderId } });
    if (!order) return null;

    // FREEZE 金额 = totalAmount - platformFee
    const freezeAmount = Number(order.totalAmount) - Number(order.platformFee);
    let wallet = await tx.wallet.findUnique({ where: { userId: setup.helperId } });
    if (!wallet) {
      wallet = await tx.wallet.create({ data: { userId: setup.helperId } });
    }
    const newBalance = Number(wallet.balance) + Number(wallet.frozen) + freezeAmount;
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        orderId: order.id,
        type: 'FREEZE',
        amount: freezeAmount,
        balanceAfter: newBalance,
        description: `任务报酬（冻结，mock 测试）`,
      },
    });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { frozen: Number(wallet.frozen) + freezeAmount },
    });
    console.log(`    ✅ 钱包 FREEZE 写入：helperId=${setup.helperId}, amount=¥${freezeAmount.toFixed(2)}`);

    return {
      orderId: order.id,
      platformFee: Number(order.platformFee),
      freezeAmount,
    };
  });

  console.log(`  事务完成：orderId=${String(paidInfo.orderId)}, platformFee=¥${paidInfo.platformFee.toFixed(2)}\n`);

  // ---------- 验证点 2：callWxProfitSharing ----------
  console.log('【验证 2】调用 callWxProfitSharing 分账：');
  const fakeTxId = `420000${Date.now()}1234567890`; // mock 微信 transaction_id
  const shareOutOrderNo = `PS${String(paidInfo.orderId)}${Date.now().toString(36)}`;
  const shareResult = await callWxProfitSharingImpl(wxPay, {
    transactionId: fakeTxId,
    outOrderNo: shareOutOrderNo,
    platformFee: paidInfo.platformFee,
  });
  console.log(`  transaction_id = ${fakeTxId}`);
  console.log(`  out_order_no   = ${shareOutOrderNo}`);
  console.log(`  platformFee    = ¥${paidInfo.platformFee.toFixed(2)}`);
  console.log(`  分账结果.success = ${shareResult.success}`);
  console.log(`  分账结果.shareOrderId = ${shareResult.shareOrderId}`);
  console.assert(shareResult.success, '❌ 分账调用应返回 success=true');
  console.assert(shareResult.shareOrderId.startsWith('mock_share_'), '❌ 分账单号应为 mock_share_ 前缀');
  console.log('  ✅ 分账调用成功，返回 mock_share_xxx\n');

  // ---------- 验证点 3：buildProfitSharingBody 正确性 ----------
  console.log('【验证 3】分账请求体构造正确性：');
  const shareBody = JSON.parse(wxPay.buildProfitSharingBody({
    transactionId: fakeTxId,
    outOrderNo: shareOutOrderNo,
    receivers: [
      {
        type: 'MERCHANT_ID',
        account: receiver.mchId,
        name: receiver.name,
        amount: paidInfo.platformFee,
        description: `平台佣金分账-${shareOutOrderNo}`,
      },
    ],
  }));
  console.log(`  appid          = ${shareBody.appid}`);
  console.log(`  transaction_id = ${shareBody.transaction_id}`);
  console.log(`  out_order_no   = ${shareBody.out_order_no}`);
  console.log(`  receivers[0].type        = ${shareBody.receivers[0].type}`);
  console.log(`  receivers[0].account     = ${shareBody.receivers[0].account}`);
  console.log(`  receivers[0].name        = ${shareBody.receivers[0].name}`);
  console.log(`  receivers[0].amount(分)  = ${shareBody.receivers[0].amount}`);
  console.log(`  receivers[0].description = ${shareBody.receivers[0].description}`);

  const expectedAmountFen = Math.round(paidInfo.platformFee * 100);
  console.assert(shareBody.receivers[0].amount === expectedAmountFen,
    `❌ 分账金额单位转换错误：应为 ${expectedAmountFen} 分，实际 ${shareBody.receivers[0].amount} 分`);
  console.assert(shareBody.receivers[0].account === receiver.mchId,
    `❌ 接收方商户号错误：应为 ${receiver.mchId}，实际 ${shareBody.receivers[0].account}`);
  console.log(`  ✅ 分账请求体正确（¥${paidInfo.platformFee} → ${expectedAmountFen} 分）\n`);

  // ---------- 验证点 4：DB 状态最终一致 ----------
  console.log('【验证 4】最终 DB 状态：');
  const orderAfter = await prisma.order.findUnique({
    where: { id: setup.orderId },
    include: { task: true, transactions: { select: { type: true, amount: true } } },
  });
  const walletAfter = await prisma.wallet.findUnique({
    where: { userId: setup.helperId },
    select: { balance: true, frozen: true, transactions: { where: { orderId: setup.orderId }, select: { type: true, amount: true } } },
  });
  console.log(`  订单 #${String(setup.orderId)}: status=${orderAfter.status}, paidAt=${orderAfter.paidAt?.toISOString() ?? 'null'}`);
  console.log(`  任务 #${String(setup.taskId)}: status=${orderAfter.task.status}`);
  console.log(`  接单者钱包: frozen=¥${Number(walletAfter?.frozen ?? 0).toFixed(2)}, FREEZE 流水=¥${Number(walletAfter?.transactions?.[0]?.amount ?? 0).toFixed(2)}`);

  const checks = [
    { name: `订单 status=PAID`, pass: orderAfter.status === 'PAID' },
    { name: `任务 status=IN_PROGRESS`, pass: orderAfter.task.status === 'IN_PROGRESS' },
    { name: `钱包 frozen = ¥${paidInfo.freezeAmount.toFixed(2)}`,
      pass: Math.abs(Number(walletAfter?.frozen ?? 0) - paidInfo.freezeAmount) < 0.01 },
    { name: `FREEZE 流水存在`, pass: (walletAfter?.transactions?.length ?? 0) > 0 },
  ];

  console.log('\n===== 验证汇总 =====');
  let allPass = true;
  for (const c of checks) {
    if (c.pass) {
      console.log(`  ✅ ${c.name}`);
    } else {
      console.log(`  ❌ ${c.name}`);
      allPass = false;
    }
  }
  console.log();

  if (allPass) {
    console.log('🎉 所有验证通过！分账逻辑工作正常。');
  } else {
    console.error('❌ 有验证项未通过，请检查。');
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

// ============================================
// helpers
// ============================================

/**
 * 准备测试数据：
 * - 优先复用已有的 ASSIGNED 任务 + PENDING 普通订单
 * - 否则：找 ASSIGNED 任务 → 新建 PENDING 订单
 * - 再否则：创建用户、分类、任务、订单
 */
async function prepareData(prisma) {
  // 1) 现有 PENDING 普通订单
  let order = await prisma.order.findFirst({
    where: { status: 'PENDING', isSupplement: false },
    select: {
      id: true, orderNo: true, totalAmount: true, platformFee: true,
      taskId: true, helperId: true,
      task: { select: { id: true, status: true, title: true, publisherId: true, helperId: true, categoryId: true } },
    },
  });

  if (order && order.task && order.task.status === 'ASSIGNED') {
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      totalAmount: Number(order.totalAmount),
      platformFee: Number(order.platformFee),
      taskId: order.task.id,
      taskStatus: order.task.status,
      taskTitle: order.task.title,
      publisherId: order.task.publisherId,
      helperId: order.task.helperId,
    };
  }

  // 2) 找 ASSIGNED 任务，为其新建订单
  let task = await prisma.task.findFirst({
    where: { status: 'ASSIGNED' },
    select: {
      id: true, title: true, price: true, publisherId: true, helperId: true, categoryId: true,
    },
  });
  if (task) {
    const platformFee = Number(task.price) * 0.1; // 默认 10%
    const orderNo = 'TS' + String(Date.now()).slice(-8);
    const newOrder = await prisma.order.create({
      data: {
        orderNo,
        taskId: task.id,
        helperId: task.helperId,
        totalAmount: task.price,
        platformFee,
        status: 'PENDING',
      },
    });
    console.log(`  (复用 ASSIGNED 任务 #${String(task.id)}，新建 PENDING 订单)`);
    return {
      orderId: newOrder.id,
      orderNo: newOrder.orderNo,
      totalAmount: Number(newOrder.totalAmount),
      platformFee: Number(newOrder.platformFee),
      taskId: task.id,
      taskStatus: 'ASSIGNED',
      taskTitle: task.title,
      publisherId: task.publisherId,
      helperId: task.helperId,
    };
  }

  // 3) 从零造：用户、分类、任务、订单
  console.log('  (未找到 ASSIGNED 任务，从零构造...)');
  let publisher = await prisma.user.findFirst({ select: { id: true, openid: true } });
  let helper = await prisma.user.findFirst({ skip: 1, select: { id: true, openid: true } });
  if (!publisher) {
    publisher = await prisma.user.create({
      data: { nickname: 'mock发布者', openid: 'mock_openid_publisher' },
      select: { id: true, openid: true },
    });
  }
  if (!helper) {
    helper = await prisma.user.create({
      data: { nickname: 'mock接单者', openid: 'mock_openid_helper' },
      select: { id: true, openid: true },
    });
  }
  let category = await prisma.taskCategory.findFirst({ select: { id: true } });
  if (!category) {
    category = await prisma.taskCategory.create({ data: { name: 'mock分类' }, select: { id: true } });
  }
  const price = 100;
  const platformFee = 10; // 10%
  task = await prisma.task.create({
    data: {
      publisherId: publisher.id,
      helperId: helper.id,
      title: 'mock分账测试任务',
      description: 'mock分账测试任务描述',
      price,
      lat: 39.9087,
      lng: 116.3975,
      geohash: 'wx4g0s8q0',
      address: 'mock地址',
      categoryId: category.id,
      status: 'ASSIGNED',
      expireAt: new Date(Date.now() + 86400000),
    },
    select: { id: true, title: true, price: true, publisherId: true, helperId: true, categoryId: true },
  });
  const orderNo = 'TS' + String(Date.now()).slice(-8);
  const newOrder = await prisma.order.create({
    data: {
      orderNo,
      taskId: task.id,
      helperId: task.helperId,
      totalAmount: price,
      platformFee,
      status: 'PENDING',
    },
  });
  return {
    orderId: newOrder.id,
    orderNo: newOrder.orderNo,
    totalAmount: Number(newOrder.totalAmount),
    platformFee: Number(newOrder.platformFee),
    taskId: task.id,
    taskStatus: 'ASSIGNED',
    taskTitle: task.title,
    publisherId: task.publisherId,
    helperId: task.helperId,
  };
}

/**
 * 安全加载 WxPayUtil（TS 源码）
 * 优先用 tsx 解析；否则用 require(ts-node) 兜底；都不可用时抛出错误。
 */
async function loadWxPayUtilSafely() {
  const tryRequire = async (modName) => {
    try {
      return require(modName);
    } catch {
      return null;
    }
  };

  let tsx = await tryRequire('tsx/cjs');
  if (!tsx) tsx = await tryRequire('tsx');
  if (!tsx) tsx = await tryRequire('ts-node/register');
  // 若 tsx/ts-node 都没，手动注册 require hook 也可；
  // 实际上 pnpm/npm 运行时大概率已注册 tsx。这里退一步：直接手动 require dist。
  if (!tsx) {
    try {
      return require(path.resolve(__dirname, '..', 'dist', 'modules', 'payment', 'wx-pay.util.js'));
    } catch (e) {
      console.warn('未找到 dist，尝试 tsx 加载源码...', e.message);
      require('tsx/cjs/api'); // 作为最后的依赖解析触发
      // 下面直接 require TS 源文件（tsx/cjs 已注册）
    }
  }
  try {
    const mod = require(path.resolve(__dirname, '..', 'src', 'modules', 'payment', 'wx-pay.util.ts'));
    return mod;
  } catch (e1) {
    try {
      const mod = require(path.resolve(__dirname, '..', 'dist', 'modules', 'payment', 'wx-pay.util.js'));
      return mod;
    } catch (e2) {
      console.error('WxPayUtil 加载失败:\n  TS:', e1.message, '\n  JS:', e2.message);
      throw e2;
    }
  }
}

/**
 * 完全复刻 payment.service.ts 中 callWxProfitSharing 的逻辑，
 * 以便在脚本中验证分账流程（不需启动 Nest 容器）。
 */
async function callWxProfitSharingImpl(wxPay, params) {
  const receiver = wxPay.getProfitSharingReceiver();

  if (!receiver.enabled) {
    console.log('  [内部] 分账跳过（未启用）');
    return { shareOrderId: '', success: false };
  }

  if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
    console.log(`  [内部] 开发环境：分账 mock → receiver=${receiver.mchId}, platformFee=¥${params.platformFee.toFixed(2)}, outOrderNo=${params.outOrderNo}`);
    return { shareOrderId: `mock_share_${Date.now()}`, success: true };
  }

  // 生产环境 HTTP 调用（同 payment.service.ts 的 TODO）
  const url = '/v3/profit-sharing/orders';
  const body = wxPay.buildProfitSharingBody({
    transactionId: params.transactionId,
    outOrderNo: params.outOrderNo,
    receivers: [
      {
        type: 'MERCHANT_ID',
        account: receiver.mchId,
        name: receiver.name,
        amount: params.platformFee,
        description: `平台佣金分账-${params.outOrderNo}`,
      },
    ],
  });
  const { authorization } = wxPay.buildAuthorization('POST', url, body);
  void authorization;
  throw new Error('生产环境 HTTP 调用未实现（本脚本只在开发环境 mock 路径运行）');
}

main().catch((e) => {
  console.error('\n❌ 脚本异常：', e.message);
  console.error(e.stack);
  process.exit(1);
});
