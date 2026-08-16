/**
 * 财务设置接口冒烟测试（Node.js 版，等价于 test-finance-settings-auth.py）
 * 运行：node scripts/test-finance-settings-auth.cjs
 *
 * 10 个 Case：权限控制 + 数据保存 + 字段校验 + 回读一致性
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

// ---- 加载 bff/.env ----
const envPath = path.join(__dirname, '..', 'bff', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { PrismaClient, Prisma } = require(path.join(__dirname, '..', 'bff', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'nh_dev_jwt_secret_2026_change_in_production';
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const API_PREFIX = '/api/v1';
const TEST_PREFIX = 'cjs_test_finance_';

// ---- 颜色 ----
const C = { G: '\x1b[32m', R: '\x1b[31m', Y: '\x1b[33m', C: '\x1b[36m', B: '\x1b[1m', X: '\x1b[0m' };
const ok = (m) => console.log(`  ${C.G}✅ ${m}${C.X}`);
const fail = (m) => console.log(`  ${C.R}❌ ${m}${C.X}`);
const info = (m) => console.log(`  ${C.Y}ℹ️  ${m}${C.X}`);
const step = (m) => console.log(`\n${C.B}${C.C}▶ ${m}${C.X}`);
const header = (t) => { const b = '='.repeat(60); console.log(`\n${C.B}${C.C}${b}\n  ${t}\n${b}${C.X}\n`); };

let passed = 0, failed = 0;
function check(name, cond, reason) {
  if (cond) { ok(`${name}: ${reason}`); passed++; }
  else { fail(`${name}: ${reason}`); failed++; }
}

// ---- HS256 JWT ----
function signJwt(payload, secret = JWT_SECRET) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

// ---- HTTP ----
function request(method, urlPath, body = null, token = null) {
  return new Promise((resolve) => {
    const fullUrl = new URL(`${API_PREFIX}${urlPath}`, BASE_URL);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: fullUrl.hostname,
      port: fullUrl.port,
      path: fullUrl.pathname,
      headers: { 'Accept': 'application/json' },
    };
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let parsed = raw;
        if (res.headers['content-type']?.includes('application/json')) {
          try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (e) => resolve({ status: -1, body: str(e) }));
    if (data) req.write(data);
    req.end();
  });
}

// ---- main ----
async function main() {
  header('🏦 财务设置接口冒烟测试 (Node.js 版)');

  // 0. 健康检查
  step('健康检查');
  let r = await request('GET', '/health');
  check('BFF 后端健康检查', r.status === 200, `HTTP ${r.status}`);

  // 1. 清理旧数据 + upsert 测试账号
  step('DB 准备：upsert 测试账号');
  const roles = ['STAFF', 'ADMIN', 'BOSS', 'SUPER_ADMIN'];
  const users = {};
  for (const role of roles) {
    const openid = `${TEST_PREFIX}${role.toLowerCase()}_${Date.now()}`;
    const u = await prisma.user.upsert({
      where: { openid },
      create: { openid, nickname: `[财务测试] ${role}`, creditScore: 100, role, status: 'ACTIVE',
        wallet: { create: { balance: 0, frozen: 0 } } },
      update: { role, nickname: `[财务测试] ${role}`, status: 'ACTIVE' },
      select: { id: true, openid: true, role: true },
    });
    users[role] = u;
    info(`upsert 角色=${role.padEnd(12)} id=${u.id} openid=${u.openid}`);
  }
  // 清空旧的财务设置
  try { await prisma.platformFinanceSetting.deleteMany({}); } catch (e) { /* ignore */ }

  const staffTok = signJwt({ sub: users.STAFF.id.toString(), role: 'STAFF', type: 'access', openid: users.STAFF.openid });
  const adminTok = signJwt({ sub: users.ADMIN.id.toString(), role: 'ADMIN', type: 'access', openid: users.ADMIN.openid });
  const bossTok = signJwt({ sub: users.BOSS.id.toString(), role: 'BOSS', type: 'access', openid: users.BOSS.openid });
  const saTok = signJwt({ sub: users.SUPER_ADMIN.id.toString(), role: 'SUPER_ADMIN', type: 'access', openid: users.SUPER_ADMIN.openid });

  // ---- Case 1: STAFF 403 ----
  step('Case 1: STAFF 无权 GET 财务设置');
  r = await request('GET', '/admin/finance-settings', null, staffTok);
  check('STAFF GET → 403', r.status === 403, `HTTP ${r.status} body=${JSON.stringify(r.body).slice(0,100)}`);

  // ---- Case 2: ADMIN 403 PUT ----
  step('Case 2: ADMIN 无权 PUT 财务设置');
  r = await request('PUT', '/admin/finance-settings', {
    profitSharingEnabled: true, receiverType: 'MERCHANT_ID',
    receiverMchId: '1600000001', receiverName: '测试',
  }, adminTok);
  check('ADMIN PUT → 403', r.status === 403, `HTTP ${r.status}`);

  // ---- Case 3: BOSS GET 200 (初始 null) ----
  step('Case 3: BOSS 能 GET 财务设置（初始为 null）');
  r = await request('GET', '/admin/finance-settings', null, bossTok);
  const d3 = r.body?.data;
  check('BOSS GET → 200 且 data=null', r.status === 200 && d3 === null, `HTTP ${r.status} data=${d3}`);

  // ---- Case 4: BOSS PUT 保存 MERCHANT_ID ----
  step('Case 4: BOSS PUT 保存商户号配置');
  r = await request('PUT', '/admin/finance-settings', {
    profitSharingEnabled: true, receiverType: 'MERCHANT_ID',
    receiverMchId: '1600111122223333', receiverName: '测试平台佣金商户号',
  }, bossTok);
  const d4 = r.body?.data;
  check('BOSS PUT → 200 且 source=created', r.status === 200 && d4?.source === 'created',
    `HTTP ${r.status} source=${d4?.source}`);

  // ---- Case 5: BOSS PUT 空商户号 → 400 ----
  step('Case 5: BOSS PUT 商户号为空 → 400');
  r = await request('PUT', '/admin/finance-settings', {
    profitSharingEnabled: true, receiverType: 'MERCHANT_ID',
    receiverMchId: '', receiverName: 'xx',
  }, bossTok);
  check('空商户号 → 400', r.status === 400, `HTTP ${r.status} body=${JSON.stringify(r.body).slice(0,120)}`);

  // ---- Case 6: SUPER_ADMIN PUT PERSONAL_OPENID ----
  step('Case 6: SUPER_ADMIN 保存 PERSONAL_OPENID 配置');
  r = await request('PUT', '/admin/finance-settings', {
    profitSharingEnabled: true, receiverType: 'PERSONAL_OPENID',
    receiverOpenid: 'o0ABCDEF1234567890abcdefghij', receiverName: '老板个人',
  }, saTok);
  const d6 = r.body?.data;
  check('SUPER_ADMIN PUT → 200 且 source=updated + receiverType=PERSONAL_OPENID',
    r.status === 200 && d6?.source === 'updated' && d6?.receiverType === 'PERSONAL_OPENID',
    `HTTP ${r.status} source=${d6?.source} type=${d6?.receiverType}`);

  // ---- Case 7: BOSS PUT 非法 AppID → 400 ----
  step('Case 7: BOSS PUT 非法 AppID → 400');
  r = await request('PUT', '/admin/finance-settings', {
    profitSharingEnabled: true, receiverType: 'MERCHANT_ID',
    receiverMchId: '1600111122223333', mainAppId: 'abc123',
  }, bossTok);
  check('非法 AppID → 400', r.status === 400, `HTTP ${r.status} body=${JSON.stringify(r.body).slice(0,120)}`);

  // ---- Case 8: 回读一致性 ----
  step('Case 8: BOSS GET 回读字段与 Case 6 一致');
  r = await request('GET', '/admin/finance-settings', null, bossTok);
  const d8 = r.body?.data;
  check('回读 receiverType=PERSONAL_OPENID, openid 前缀匹配',
    r.status === 200 && d8?.receiverType === 'PERSONAL_OPENID'
    && (d8?.receiverOpenid || '').startsWith('o0ABCDEF'),
    `HTTP ${r.status} type=${d8?.receiverType} openid=${d8?.receiverOpenid?.slice(0,10)}...`);
  if (d8?.updatedBy) info(`updatedBy（SUPER_ADMIN uid）: ${d8.updatedBy}`);

  // ---- Case 9: 无 token → 401 ----
  step('Case 9: 未登录（无 Token）→ 401');
  r = await request('GET', '/admin/finance-settings');
  check('无 token → 401/403', r.status === 401 || r.status === 403, `HTTP ${r.status}`);

  // ---- Case 10: 关闭分账 ----
  step('Case 10: BOSS 关闭分账开关 → GET 回读 false');
  r = await request('PUT', '/admin/finance-settings', {
    profitSharingEnabled: false, receiverType: 'MERCHANT_ID',
  }, bossTok);
  const d10 = r.body?.data;
  const putOk = r.status === 200 && d10?.profitSharingEnabled === false;
  check('关闭分账 → PUT 成功 profitSharingEnabled=false', putOk, `HTTP ${r.status}`);
  if (putOk) {
    r = await request('GET', '/admin/finance-settings', null, bossTok);
    const d10b = r.body?.data;
    check('GET 回读 profitSharingEnabled=false',
      r.status === 200 && d10b?.profitSharingEnabled === false,
      `HTTP ${r.status} enabled=${d10b?.profitSharingEnabled}`);
  } else {
    check('GET 回读（跳过）', false, '前置 PUT 失败');
  }

  // ---- 汇总 ----
  header('📊 测试汇总');
  const total = passed + failed;
  console.log(`  ${C.G}通过: ${passed}${C.X} / ${C.R}失败: ${failed}${C.X} / 总计: ${total}`);
  if (failed === 0) console.log(`\n  ${C.G}${C.B}🎉 全部 ${total} 个 Case 通过！${C.X}`);
  else console.log(`\n  ${C.R}${C.B}⚠️  有 ${failed} 个 Case 失败，请检查上方输出。${C.X}`);

  // ---- 回滚 ----
  step('清理：删除测试账号 + 清空财务设置');
  try {
    const uids = Object.values(users).map(u => BigInt(u.id));
    await prisma.auditLog.deleteMany({ where: { adminId: { in: uids } } });
    await prisma.transaction.deleteMany({ where: { wallet: { userId: { in: uids } } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: uids } } });
    await prisma.platformFinanceSetting.deleteMany({});
    await prisma.user.deleteMany({ where: { openid: { startsWith: TEST_PREFIX } } });
    ok('回滚完成');
  } catch (e) {
    fail(`回滚失败: ${e.message}`);
  }

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(2);
});
