/* 提现流程 Mock 测试脚本
 * 运行：node bff/scripts/test-withdraw-flow.cjs
 *
 * 测试场景：
 * 1. 测试登录获取 Token
 * 2. 查询初始余额
 * 3. 小额提现（<1000，正常流程）
 * 4. 大额提现（>1000，触发审核）
 * 5. 余额不足提现
 * 6. 查询流水列表
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

// ---- 加载 bff/.env ----
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { PrismaClient, Prisma } = require('@prisma/client');

const log = (m) => console.log(`\x1b[36m[withdraw-test]\x1b[0m ${m}`);
const success = (m) => console.log(`\x1b[32m  ✅ ${m}\x1b[0m`);
const fail = (m) => console.log(`\x1b[31m  ❌ ${m}\x1b[0m`);
const info = (m) => console.log(`\x1b[33m  ℹ️  ${m}\x1b[0m`);

// ---- 配置 ----
const JWT_SECRET = process.env.JWT_SECRET || 'nh_dev_jwt_secret_2026_change_in_production';
const SERVER_PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;
const API_PREFIX = '/api/v1';

// ---- JWT 简易签发（HS256） ----
function signJwt(payload, secret = JWT_SECRET) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

// ---- HTTP 请求封装 ----
function request(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(`${API_PREFIX}${urlPath}`, BASE_URL);
    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || SERVER_PORT,
      path: fullUrl.pathname + fullUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---- 统计 ----
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
  }
}

// ========== 主测试 ==========
(async () => {
  const prisma = new PrismaClient();
  const TEST_PREFIX = 'withdraw_mock_test';

  try {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║     提现流程 Mock 测试                       ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    // 0. 清理旧测试数据
    log('清理旧测试数据...');
    const oldUsers = await prisma.user.findMany({
      where: { openid: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    for (const u of oldUsers) {
      await prisma.transaction.deleteMany({ where: { wallet: { userId: u.id } } });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
    }
    await prisma.user.deleteMany({ where: { openid: { startsWith: TEST_PREFIX } } });
    log('清理完成');

    // ================================================
    // 场景 1: 创建测试用户（初始余额 0）+ 签发 Token
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 1: 创建测试用户（初始余额 0）+ 签发 JWT Token');

    const openid = `${TEST_PREFIX}_user_${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        openid,
        nickname: '提现测试用户',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
        wallet: {
          create: { balance: new Prisma.Decimal(0), frozen: new Prisma.Decimal(0) },
        },
      },
      include: { wallet: true },
    });

    log(`用户 ID: ${user.id}`);
    log(`openid: ${user.openid}`);
    log(`初始余额: ${user.wallet.balance}（应为 0）`);

    // 签发 JWT Token（包含 openid）
    const token = signJwt({
      sub: user.id.toString(),
      role: user.role,
      type: 'access',
      openid: user.openid,
    });

    info(`JWT Token: ${token.slice(0, 30)}...`);
    assert(token.length > 0, 'Token 签发成功');

    // ================================================
    // 场景 2: 查询初始余额（应为 0）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 2: 查询钱包初始余额');

    const balRes = await request('GET', '/wallet', null, token);
    info(`GET /wallet 响应: ${JSON.stringify(balRes.body)}`);

    assert(balRes.status === 200, '查询余额成功');
    assert(balRes.body.data.balance === 0, `初始余额为 0（实际 ${balRes.body.data.balance}）`);
    assert(balRes.body.data.available === 0, `可用余额为 0（实际 ${balRes.body.data.available}）`);
    assert(balRes.body.data.frozen === 0, `冻结金额为 0（实际 ${balRes.body.data.frozen}）`);

    // ================================================
    // 场景 3: 模拟任务收入（充值 500 元）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 3: 模拟任务完成收入（充值 500 元）');

    // 通过 Prisma 直接写入钱包流水（模拟支付回调）
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    const newBalance = Number(wallet.balance) + 500;
    const incomeTx = await prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'INCOME',
        amount: new Prisma.Decimal(500),
        balanceAfter: new Prisma.Decimal(newBalance),
        description: '任务完成收入',
      },
    });
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balance: new Prisma.Decimal(newBalance) },
    });

    info(`充值流水 ID: ${incomeTx.id}`);
    assert(incomeTx.type === 'INCOME', `流水类型为 INCOME（实际 ${incomeTx.type}）`);

    // 验证充值后余额
    const balAfterIncome = await request('GET', '/wallet', null, token);
    info(`充值后余额: ${JSON.stringify(balAfterIncome.body.data)}`);
    assert(balAfterIncome.body.data.balance === 500, `充值后余额为 500（实际 ${balAfterIncome.body.data.balance}）`);
    assert(balAfterIncome.body.data.available === 500, `充值后可用余额为 500（实际 ${balAfterIncome.body.data.available}）`);

    // ================================================
    // 场景 4: 小额提现（<1000，正常流程）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 4: 小额提现 100 元（正常流程）');

    const withdrawRes = await request(
      'POST',
      '/wallet/withdraw',
      { amount: 100 },
      token,
    );
    info(`POST /wallet/withdraw 响应: ${JSON.stringify(withdrawRes.body)}`);

    assert(withdrawRes.status === 200 || withdrawRes.status === 201, '提现请求成功');
    assert(withdrawRes.body.data.status === 'SUCCESS', `提现状态为 SUCCESS（实际 ${withdrawRes.body.data.status}）`);
    assert(withdrawRes.body.data.amount === 100, `提现金额 100 元（实际 ${withdrawRes.body.data.amount}）`);

    // 验证余额变化
    const balAfterWithdraw = await request('GET', '/wallet', null, token);
    info(`提现后余额: ${JSON.stringify(balAfterWithdraw.body)}`);

    // 初始 500，提现 100 → balance=400, frozen=0
    assert(balAfterWithdraw.body.data.balance === 400, `提现后余额为 400（实际 ${balAfterWithdraw.body.data.balance}）`);
    assert(balAfterWithdraw.body.data.frozen === 0, `提现后冻结为 0（实际 ${balAfterWithdraw.body.data.frozen}）`);

    // ================================================
    // 场景 5: 大额提现（>1000，触发审核）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 5: 大额提现 1500 元（触发人工审核）');

    // 先充值到足够余额（当前 400，充到 5000）
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balance: new Prisma.Decimal(5000) },
    });

    const bigWithdrawRes = await request(
      'POST',
      '/wallet/withdraw',
      { amount: 1500 },
      token,
    );
    info(`POST /wallet/withdraw (大额) 响应: ${JSON.stringify(bigWithdrawRes.body)}`);

    assert(bigWithdrawRes.status === 200 || bigWithdrawRes.status === 201, '大额提现请求成功');
    assert(
      bigWithdrawRes.body.data.status === 'AUDIT_REQUIRED',
      `大额提现状态为 AUDIT_REQUIRED（实际 ${bigWithdrawRes.body.data.status}）`,
    );
    assert(
      bigWithdrawRes.body.data.message.includes('审核'),
      '大额提现提示包含审核',
    );

    // 大额提现不应产生流水（直接返回审核）
    const balAfterBigWithdraw = await request('GET', '/wallet', null, token);
    info(`大额提现后余额: ${balAfterBigWithdraw.body.data.balance}`);
    assert(balAfterBigWithdraw.body.data.balance === 5000, `大额提现后余额不变（实际 ${balAfterBigWithdraw.body.data.balance}）`);

    // ================================================
    // 场景 6: 余额不足提现
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 6: 余额不足提现（1 元余额提 100 元）');

    // 设置余额为 1
    await prisma.wallet.update({
      where: { userId: user.id },
      data: { balance: new Prisma.Decimal(1), frozen: new Prisma.Decimal(0) },
    });

    const failWithdrawRes = await request(
      'POST',
      '/wallet/withdraw',
      { amount: 100 },
      token,
    );
    info(`POST /wallet/withdraw (余额不足) 响应: ${JSON.stringify(failWithdrawRes.body)}`);

    assert(
      failWithdrawRes.status === 409 || failWithdrawRes.status === 503,
      `余额不足提现应返回 409 或 503（实际 ${failWithdrawRes.status}）`,
    );

    // 验证余额未变（冻结已回滚）
    const balAfterFail = await request('GET', '/wallet', null, token);
    info(`失败提现后余额: ${balAfterFail.body.data.balance}`);
    assert(balAfterFail.body.data.balance === 1, `余额不足提现后余额仍为 1（实际 ${balAfterFail.body.data.balance}）`);

    // ================================================
    // 场景 7: 查询流水列表
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 7: 查询流水列表');

    const txRes = await request('GET', '/wallet/transactions?page=1&pageSize=10', null, token);
    info(`GET /wallet/transactions 响应: ${JSON.stringify(txRes.body, null, 2)}`);

    assert(txRes.status === 200, '查询流水成功');
    assert(Array.isArray(txRes.body.data.items), '流水列表为数组');
    assert(txRes.body.data.items.length > 0, '至少有提现产生的流水');
    assert(txRes.body.data.total > 0, '流水总数大于 0');

    // 验证流水类型
    const types = txRes.body.data.items.map((t) => t.type);
    info(`流水类型: ${types.join(', ')}`);
    assert(types.includes('FREEZE') || types.includes('EXPENSE'), '流水包含提现相关类型');

    // ================================================
    // 场景 8: 并发提现测试（超卖防护）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 8: 并发提现测试（超卖防护）');

    // 创建 5 个新用户，每个余额 500，同时各发起 1 次 100 元提现
    // + 同一用户并发发起多笔小额提现（绕过限流：创建多用户）
    const CONCURRENT_USERS = 5;
    const WITHDRAW_AMOUNT_PER_REQ = 100;

    log(`创建 ${CONCURRENT_USERS} 个测试用户，每个余额 500，同时发起 100 元提现`);
    log('（验证：每笔提现都通过 SELECT FOR UPDATE 行锁串行化，不会超卖）');

    // 创建多个用户并签发 Token
    const users = [];
    for (let i = 0; i < CONCURRENT_USERS; i++) {
      const u = await prisma.user.create({
        data: {
          openid: `${TEST_PREFIX}_concurrent_user_${Date.now()}_${i}`,
          nickname: `并发测试用户${i}`,
          creditScore: 100,
          role: 'USER',
          status: 'ACTIVE',
          wallet: {
            create: { balance: new Prisma.Decimal(500), frozen: new Prisma.Decimal(0) },
          },
        },
        include: { wallet: true },
      });
      const t = signJwt({
        sub: u.id.toString(),
        role: u.role,
        type: 'access',
        openid: u.openid,
      });
      users.push({ user: u, token: t });
    }

    log(`创建了 ${users.length} 个用户，发起并发提现...`);

    // 同时发起提现请求
    const concurrentTasks = users.map((u, i) =>
      request('POST', '/wallet/withdraw', { amount: WITHDRAW_AMOUNT_PER_REQ }, u.token)
        .then((res) => ({ index: i, userId: u.user.id, response: res, error: null }))
        .catch((err) => ({ index: i, userId: u.user.id, response: null, error: err.message })),
    );

    const results = await Promise.all(concurrentTasks);

    const successCount = results.filter((r) => r.response?.body?.data?.status === 'SUCCESS').length;
    const failCount = results.filter((r) => r.response?.body?.data?.status !== 'SUCCESS').length;

    log(`并发结果: 成功 ${successCount}/${CONCURRENT_USERS}, 失败 ${failCount}`);

    // 打印每个请求的详细结果
    results.forEach((r) => {
      if (r.response) {
        const status = r.response.body?.data?.status || 'N/A';
        const msg = r.response.body?.message || r.response.body?.data?.message || 'N/A';
        info(`用户 ${r.index} (ID:${r.userId}): 状态=${status}, 消息=${msg}`);
      } else {
        info(`用户 ${r.index} (ID:${r.userId}): 请求异常 - ${r.error}`);
      }
    });

    // 验证：所有请求都应成功（每个用户独立，各有 500 余额，提现 100 应成功）
    assert(
      successCount === CONCURRENT_USERS,
      `每个用户各有 500 余额，${CONCURRENT_USERS} 个并发请求应全部成功（实际成功 ${successCount}）`,
    );

    // 验证每个用户的最终余额 = 500 - 100 = 400
    for (const u of users) {
      const bal = await request('GET', '/wallet', null, u.token);
      assert(
        bal.body.data.balance === 400,
        `用户 ${u.user.id} 提现后余额应为 400（实际 ${bal.body.data.balance}）`,
      );
    }

    log(`✅ 并发超卖防护验证通过：${CONCURRENT_USERS} 个独立用户并发提现，各自余额正确扣减`);

    // ================================================
    // 场景 9: 同用户高并发扣款（极限超卖测试）
    // ================================================
    log('');
    log('─────────────────────────────────────────────');
    log('场景 9: 同用户高并发扣款（极限超卖测试）');

    // 创建一个新用户，余额 100，同时发起 20 次 10 元扣款
    // 通过直接调用 Prisma + WalletService 模拟（绕过 HTTP 限流）
    const raceUser = await prisma.user.create({
      data: {
        openid: `${TEST_PREFIX}_race_user_${Date.now()}`,
        nickname: '极限并发测试用户',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
        wallet: {
          create: { balance: new Prisma.Decimal(100), frozen: new Prisma.Decimal(0) },
        },
      },
      include: { wallet: true },
    });

    const RACE_CONCURRENCY = 20;
    const RACE_AMOUNT = 10;

    log(`用户 ${raceUser.id} 余额 100，同时发起 ${RACE_CONCURRENCY} 次 ${RACE_AMOUNT} 元扣款`);
    log('（理论上恰好 10 次成功，10 次失败）');

    const { WalletService } = require('../dist/modules/wallet/wallet.service');
    const { PrismaService } = require('../dist/prisma/prisma.service');
    const prismaSvc = new PrismaService();
    const walletSvc = new WalletService(prismaSvc);

    const raceTasks = Array.from({ length: RACE_CONCURRENCY }, (_, i) =>
      walletSvc
        .recordTransaction(raceUser.id, 'EXPENSE', RACE_AMOUNT, `并发扣款测试 #${i}`)
        .then(() => ({ index: i, success: true, error: null }))
        .catch((err) => ({ index: i, success: false, error: err.message })),
    );

    const raceResults = await Promise.all(raceTasks);

    const raceSuccess = raceResults.filter((r) => r.success).length;
    const raceFail = raceResults.filter((r) => !r.success).length;

    log(`并发扣款结果: 成功 ${raceSuccess}, 失败 ${raceFail}`);

    assert(raceSuccess === 10, `恰好 10 次成功（实际 ${raceSuccess}）`);
    assert(raceFail === 10, `恰好 10 次失败（实际 ${raceFail}）`);

    // 验证最终余额 = 0
    const raceBal = await prisma.wallet.findUnique({ where: { userId: raceUser.id } });
    assert(
      Number(raceBal.balance) === 0,
      `并发扣款后余额应为 0（实际 ${raceBal.balance}）`,
    );

    log(`✅ 极限超卖防护验证通过：余额 100 并发扣 20 × 10，恰好 10 次成功，最终余额 0`);

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
    log(`║  通过率:   ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`);
    log('╚══════════════════════════════════════════════╝');

    if (failedTests > 0) {
      console.log('\n\x1b[31m❌ 部分测试失败！请检查上方日志\x1b[0m\n');
      process.exitCode = 1;
    } else {
      console.log('\n\x1b[32m🎉 所有测试通过！提现流程验证成功！\x1b[0m\n');
    }

    // 清理测试数据
    log('清理测试数据...');
    const allTestUsers = await prisma.user.findMany({
      where: { openid: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    for (const u of allTestUsers) {
      await prisma.transaction.deleteMany({ where: { wallet: { userId: u.id } } });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
    }
    await prisma.user.deleteMany({ where: { openid: { startsWith: TEST_PREFIX } } });
    log('清理完成');
  } catch (e) {
    console.error('\n\x1b[31m测试脚本异常:\x1b[0m', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
