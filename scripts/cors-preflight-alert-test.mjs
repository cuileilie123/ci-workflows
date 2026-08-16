#!/usr/bin/env node
/**
 * CORS 预检请求告警触发器
 *
 * 用途：模拟浏览器 / 第三方站点发起大量带不同 Origin 头的 OPTIONS 预检请求，
 *       用来验证 BFF 的 CORS 403 日志 (WARN [CORS] [LOG-CO-001] status=403)
 *       能否真实触发 Loki / ELK / 云日志告警规则。
 *
 * 用法：
 *   # 1) 基础模式：跑一轮 5 合法 + 15 非法 origin，验证 204 / 403 基本判定
 *   node scripts/cors-preflight-alert-test.mjs
 *
 *   # 2) 压力模式：每批 20 个非法 origin × 循环 3 轮 = 60 次 403，
 *   #    轻松跨越 "5min 内 > 5 次" 这类常见告警阈值
 *   node scripts/cors-preflight-alert-test.mjs --loops 3 --evil-batch 20
 *
 *   # 3) 指定 BFF 地址 + 自定义并发
 *   node scripts/cors-preflight-alert-test.mjs \
 *       --target http://10.0.0.5:3000 \
 *       --concurrency 8 \
 *       --loops 5
 *
 *   # 4) 只打 403（纯非法流量）用于验证告警不被合法请求冲淡
 *   node scripts/cors-preflight-alert-test.mjs --evil-only --loops 10 --evil-batch 30
 *
 * 脚本跑完会输出 3 段结果：
 *   § Summary         : 统计 204/403 数、通过 / 失败断言数
 *   § grep cheatsheet : 可直接复制的日志查询命令（按 reqId / 锚点）
 *   § per-reqId list  : 每个请求的 reqId，供精确 grep 单条日志
 */

import http from 'node:http';
import { parseArgs } from 'node:util';

/* ─────────────────────── CLI 参数解析 ─────────────────────── */
const {
  values: {
    target = 'http://localhost:3000',
    loops = 1,
    'evil-batch': evilBatch = 15,
    concurrency = 6,
    'evil-only': evilOnly = false,
    'request-path': requestPath = '/api/v1/auth/wx-login',
    quiet = false,
  },
} = parseArgs({
  options: {
    target:       { type: 'string', short: 't' },
    loops:        { type: 'string', short: 'l' }, // 解析完再转 Number
    'evil-batch': { type: 'string' },
    concurrency:  { type: 'string', short: 'c' },
    'evil-only':  { type: 'boolean' },
    'request-path': { type: 'string' },
    quiet:        { type: 'boolean', short: 'q' },
  },
});

const LOOPS       = Number(loops) || 1;
const EVIL_BATCH  = Number(evilBatch) || 15;
const CONCURRENCY = Number(concurrency) || 6;
const TARGET      = target.replace(/\/$/, '');
const PATH        = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;

/* ─────────────────────── 内置白名单 origin（对齐 BFF main.ts） ─────────────────────── */
const ALLOWED_ORIGINS = [
  { label: 'H5 main',          origin: 'https://neighborhood-help.com',          ref: 'https://neighborhood-help.com/dashboard' },
  { label: 'H5 www',           origin: 'https://www.neighborhood-help.com',      ref: 'https://www.neighborhood-help.com/about' },
  { label: 'WeChat service',   origin: 'https://servicewechat.com',              ref: 'https://servicewechat.com/wx4766fcfd6ecf06f1/page-frame.html' },
  { label: 'Local vite :5173', origin: 'http://localhost:5173',                   ref: 'http://localhost:5173/login' },
  { label: 'Local 127 :8080',  origin: 'http://127.0.0.1:8080',                  ref: 'http://127.0.0.1:8080/' },
];

/* ─────────────────────── 非法 origin 样本（典型场景覆盖） ─────────────────────── */
const EVIL_TEMPLATES = [
  // 1) 完全无关的域名（典型扫描器 / 撞库来源）
  ({ i }) => ({ label: `evil-random-${i}`, origin: `https://evil-site-${i}.com`,                ref: `https://evil-site-${i}.com/hack` }),
  // 2) 仿冒我们域名的子域名（钓鱼 / 同源绕过尝试）
  ({ i }) => ({ label: `phish-sub-${i}`,    origin: `https://hacker-${i}.neighborhood-help.top`, ref: `https://hacker-${i}.neighborhood-help.top/login` }),
  // 3) HTTP 协议的官方域名（HSTS 未强制下的降级尝试）
  ({ i }) => ({ label: `http-downgrade-${i}`, origin: `http://neighborhood-help${i}.com`,       ref: `http://neighborhood-help${i}.com/` }),
  // 4) 其他小程序 / 第三方 CDN 域
  ({ i }) => ({ label: `third-party-${i}`,  origin: `https://cdn${i}.qcloud.la`,                 ref: '-' }),
  // 5) HTTPS 变体的 localhost（注意：白名单仅放行 http://localhost，https://localhost 属于未加白的 → 必拦截）
  ({ i }) => ({ label: `https-localhost-${i}`, origin: `https://localhost:${30000 + i}`,    ref: `https://localhost:${30000 + i}/` }),
  // 6) https://127.x.x.x 变体（白名单只放行了 http://127.0.0.1 且严格末尾锚定，非该段+https 全拦截）
  ({ i }) => ({ label: `https-127var-${i}`,   origin: `https://127.0.0.${50 + i}:${8080 + i}`, ref: '-' }),
  // 7) http://127.0.1.x (非白名单的 127 变体，白名单是精确的 127.0.0.1)
  ({ i }) => ({ label: `ip-127-var-${i}`,    origin: `http://127.0.1.${10 + i}:3000`,          ref: '-' }),
  // 8) 带端口的正式域名变体（非标准端口尝试）
  ({ i }) => ({ label: `bad-port-${i}`,     origin: `https://neighborhood-help.com:${8443 + i}`, ref: '-' }),
  // 9) IP 直连（常见内网扫描）
  ({ i }) => ({ label: `ip-scan-${i}`,      origin: `http://192.168.1.${10 + i}:3000`,            ref: '-' }),
  // 10) 双写 / 错拼域名
  ({ i }) => ({ label: `typo-${i}`,         origin: `https://neighbourhood-help${i}.com`,         ref: '-' }),
];

function makeEvilBatch(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const tmpl = EVIL_TEMPLATES[i % EVIL_TEMPLATES.length];
    out.push(tmpl({ i: Math.floor(i / EVIL_TEMPLATES.length) * 100 + (i % EVIL_TEMPLATES.length) }));
  }
  return out;
}

/* ─────────────────────── UA / IP 池（让日志字段更丰富，验证告警规则是否用到了这些维度） ─────────────────────── */
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.52',
  'NeighborhoodHelpCorsAlertTest/1.0 (+https://github.com/neighborhood-help; purpose=monitoring-verify)',
  'curl/8.4.0',
  'python-requests/2.31.0 (attack-scanner)',
];
const SPOOF_IPS = [
  '203.0.113.45',                 // 常见测试公网 IP
  '198.51.100.23',                // 另一段文档 IP
  '45.${rnd}.${rnd}.${rnd}'.replace(/\$\{rnd\}/g, () => (Math.floor(Math.random() * 250) + 1)),
  '10.0.8.88',                    // 内网
];
const METHODS = ['OPTIONS']; // 预检标准方法 OPTIONS；若混用 POST，已通过白名单的 origin 会进入路由层，返回 4xx Validation 而非 204/403 纯 CORS 判定，干扰断言

/* ─────────────────────── 核心：单次 HTTP 请求（原生 http 模块，无第三方依赖） ─────────────────────── */
function sendOne({ origin, method, referer, ua, xff }) {
  const url = new URL(TARGET + PATH);
  return new Promise((resolve) => {
    const headers = {
      Host: url.host,
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization,Content-Type,X-Device-Fp',
      'User-Agent': ua,
      Referer: referer,
      Accept: '*/*',
    };
    if (xff) headers['X-Forwarded-For'] = xff;

    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers,
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 400);
          resolve({
            status: res.statusCode || 0,
            allowOrigin: res.headers['access-control-allow-origin'] || '-',
            credentials: res.headers['access-control-allow-credentials'] || '-',
            reqId: res.headers['x-request-id'] || '-',
            body,
          });
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => {
      resolve({ status: -1, allowOrigin: '-', credentials: '-', reqId: '-', body: `ERROR: ${err.message}` });
    });
    req.end();
  });
}

/* ─────────────────────── 并发控制（简易 Promise 池） ─────────────────────── */
async function poolRun(tasks, limit, onProgress) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const idx = cursor++;
      const t = tasks[idx];
      const r = await t.fn();
      results[idx] = { ...t.meta, ...r };
      if (onProgress) onProgress(idx, tasks.length);
    }
  });
  await Promise.all(workers);
  return results;
}

/* ─────────────────────── 组装一轮任务 ─────────────────────── */
function buildRound(roundIdx) {
  const tasks = [];
  if (!evilOnly) {
    for (const item of ALLOWED_ORIGINS) {
      tasks.push({
        fn: () => sendOne({
          origin: item.origin,
          method: 'OPTIONS',
          referer: item.ref,
          ua: UAS[roundIdx % UAS.length],
          xff: SPOOF_IPS[roundIdx % SPOOF_IPS.length],
        }),
        meta: { round: roundIdx + 1, label: item.label, origin: item.origin, expect: 204, category: 'ALLOWED' },
      });
    }
  }
  const evils = makeEvilBatch(EVIL_BATCH);
  evils.forEach((item, k) => {
    tasks.push({
      fn: () => sendOne({
        origin: item.origin,
        method: METHODS[(roundIdx + k) % METHODS.length],
        referer: item.ref,
        ua: UAS[(roundIdx + k + 2) % UAS.length],
        xff: SPOOF_IPS[(roundIdx + k) % SPOOF_IPS.length],
      }),
      meta: { round: roundIdx + 1, label: item.label, origin: item.origin, expect: 403, category: 'EVIL' },
    });
  });
  return tasks;
}

/* ─────────────────────── 主流程 ─────────────────────── */
async function main() {
  const banner = (s) => !quiet && console.log(`\n=== ${s} ${'='.repeat(Math.max(0, 60 - s.length))}`);
  banner('CORS 预检告警触发器 启动');
  console.log(`target=${TARGET}  path=${PATH}  loops=${LOOPS}  evil-batch=${EVIL_BATCH}  concurrency=${CONCURRENCY}  evil-only=${evilOnly}`);

  // 预热：探测 BFF 可达
  try {
    const probe = await sendOne({ origin: 'https://neighborhood-help.com', method: 'OPTIONS', referer: '-', ua: 'probe/1.0', xff: null });
    if (probe.status === -1) throw new Error(probe.body);
    console.log(`[PRE-FLIGHT] BFF 可达: status=${probe.status}  reqId=${probe.reqId}`);
  } catch (e) {
    console.error(`[FATAL] BFF ${TARGET} 不可达: ${e.message}`);
    console.error('请先启动 BFF：  cd bff && pnpm start:dev  (或 nest start)');
    process.exit(2);
  }

  // 生成所有轮次任务
  const allTasks = [];
  for (let r = 0; r < LOOPS; r++) allTasks.push(...buildRound(r));
  console.log(`[TASKS] 共 ${allTasks.length} 个请求 (ALLOWED=${evilOnly ? 0 : LOOPS * ALLOWED_ORIGINS.length}, EVIL=${LOOPS * EVIL_BATCH})`);

  // 执行
  let done = 0;
  const start = Date.now();
  const results = await poolRun(allTasks, CONCURRENCY, (i, total) => {
    done++;
    if (!quiet && (done % 15 === 0 || done === total)) {
      process.stdout.write(`  progress: ${done}/${total} (${Math.round((done / total) * 100)}%)\r`);
    }
  });
  if (!quiet) process.stdout.write('\n');

  /* ─────────────────── 汇总统计 ─────────────────── */
  banner('Summary');
  const counts = { 204: 0, 403: 0, other: 0, error: 0 };
  let passAssert = 0, failAssert = 0;
  const fails = [];
  const reqIdsByCat = { ALLOWED: [], EVIL: [] };

  for (const r of results) {
    if (r.status === -1) counts.error++;
    else if (r.status === 204) counts[204]++;
    else if (r.status === 403) counts[403]++;
    else counts.other++;

    const ok = r.status === r.expect;
    if (ok) passAssert++;
    else { failAssert++; fails.push(r); }

    if (r.reqId && r.reqId !== '-') reqIdsByCat[r.category].push({ label: r.label, origin: r.origin, reqId: r.reqId, status: r.status });
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`耗时: ${elapsed}s   并发: ${CONCURRENCY}   QPS≈${(results.length / Math.max(Number(elapsed), 0.001)).toFixed(1)}`);
  console.log(`响应分布: 204(allowed)=${counts[204]}  403(blocked)=${counts[403]}  其他=${counts.other}  网络错误=${counts.error}`);
  console.log(`断言结果: PASS=${passAssert}  FAIL=${failAssert}  (期望: ALLOWED→204, EVIL→403)`);

  if (fails.length) {
    console.log('\n[FAILED 断言抽样 (最多 10 条)]');
    fails.slice(0, 10).forEach((r) => {
      console.log(`  - [${r.category}] label=${r.label}  origin=${r.origin}  expect=${r.expect}  actual=${r.status}  body=${r.body.replace(/\s+/g, ' ').slice(0, 120)}`);
    });
  }

  /* ─────────────────── grep cheat sheet ─────────────────── */
  banner('grep cheatsheet  (复制到 BFF 日志文件或云日志平台查询)');
  const sampleEvilReqId = reqIdsByCat.EVIL[0]?.reqId;
  const sampleAllowReqId = reqIdsByCat.ALLOWED[0]?.reqId;
  const evilTotal = reqIdsByCat.EVIL.length;
  const allowTotal = reqIdsByCat.ALLOWED.length;

  const lines = [
    '# 403 非法来源告警核心规则（直接贴进 Loki / ELK 查询框）',
    `1) WARN 级别 + CORS 上下文 + LOG-CO-001 锚点:  "WARN" AND "[CORS]" AND "[LOG-CO-001]" AND "status=403"`,
    `2) 按 origin 聚合 Top N:  "WARN [CORS]" | stats count() by origin`,
    `3) 5 分钟窗口阈值 (>5 次):  "WARN [CORS] [LOG-CO-001]" | window 5m | count > 5`,
    '',
    '# 放行流量看板（验证白名单没被误杀）',
    `4) 成功放行:  "LOG [CORS] [LOG-CO-002] status=allowed"`,
    '',
    '# 本次脚本生成的具体样本：按 reqId 精准 grep 验证单条日志',
    sampleEvilReqId ? `5) 单条 403 样本:  grep "${sampleEvilReqId}"  <BFF-log-file>` : '5) (无 403 reqId，可能 BFF 未返回 X-Request-Id)',
    sampleAllowReqId ? `6) 单条 204 样本:  grep "${sampleAllowReqId}"  <BFF-log-file>` : '6) (无 204 reqId)',
    '',
    '# 本次批次规模（供确认告警阈值是否被跨线）',
    `7) 本轮 403 总数 = ${evilTotal} 条  (告警阈值通常设为 5~20 条/5min，当前已跨越 ${evilTotal >= 5 ? '✅' : '⚠️(可加 --loops 或 --evil-batch)'})`,
    allowTotal ? `8) 本轮放行总数 = ${allowTotal} 条` : '',
  ];
  lines.forEach((l) => console.log(l));

  /* ─────────────────── per-reqId 清单 ─────────────────── */
  banner('per-reqId 清单  (最多展示前 5 + 后 5)');
  const printSlice = (arr, title) => {
    if (!arr.length) return;
    console.log(`\n--- ${title} (共 ${arr.length}) ---`);
    const head = arr.slice(0, 5);
    const tail = arr.length > 10 ? arr.slice(-5) : [];
    head.forEach((x) => console.log(`  reqId=${x.reqId}  status=${x.status}  ${x.label.padEnd(20)} origin=${x.origin}`));
    if (tail.length) {
      console.log(`  ... (中间 ${arr.length - 10} 条省略) ...`);
      tail.forEach((x) => console.log(`  reqId=${x.reqId}  status=${x.status}  ${x.label.padEnd(20)} origin=${x.origin}`));
    }
  };
  if (!evilOnly) printSlice(reqIdsByCat.ALLOWED, 'ALLOWED 放行');
  printSlice(reqIdsByCat.EVIL, 'EVIL 拦截 403');

  process.exit(failAssert > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[UNEXPECTED]', e);
  process.exit(99);
});
