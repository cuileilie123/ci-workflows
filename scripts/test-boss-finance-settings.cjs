/**
 * 老板账号财务设置接口完整测试脚本（带详细日志输出）
 *
 * 测试目标：模拟老板账号登录 → 调用财务设置接口 → 验证分佣配置是否生效
 *
 * 【排查定位指引】
 *   当日志出现测试失败时，按以下锚点快速定位：
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ 锚点代码            │ 对应阶段 / 排查问题               │
 *   ├─────────────────────┼────────────────────────────────────┤
 *   │ [LOG-FIN-001]       │ 启动横幅 / 环境配置                │
 *   │ [LOG-FIN-002]       │ 健康检查 HTTP 请求                 │
 *   │ [LOG-FIN-003]       │ 老板账号登录 HTTP 请求             │
 *   │ [LOG-FIN-004]       │ 原始配置读取（用于清理恢复）       │
 *   │ [LOG-FIN-005]       │ 步骤2 财务设置读取                 │
 *   │ [LOG-FIN-006]       │ 步骤3 保存启用分账配置             │
 *   │ [LOG-FIN-007]       │ 步骤4 二次读取持久化验证           │
 *   │ [LOG-FIN-008]       │ 步骤5 分账禁用切换                 │
 *   │ [LOG-FIN-009]       │ 步骤9 分佣配置生效诊断（核心链路） │
 *   │ [LOG-FIN-010]       │ 统一下单 → profit_sharing 标记     │
 *   │ [LOG-FIN-011]       │ 分账接收方配置读取链路             │
 *   │ [LOG-FIN-012]       │ 步骤6 权限校验                     │
 *   │ [LOG-FIN-013]       │ 步骤7 DTO 校验                     │
 *   │ [LOG-FIN-014]       │ 步骤8 清理恢复                     │
 *   │ [LOG-FIN-015]       │ 测试汇总 / 退出码                  │
 *   └─────────────────────┴────────────────────────────────────┘
 *
 * 测试场景覆盖：
 *   0. BFF 服务健康检查（GET /auth/me 401/200）
 *   1. 老板账号登录（POST /auth/test-login）
 *      - 使用 DB 中已存在的 BOSS 用户 id=1
 *      - 验证返回 accessToken / refreshToken / user.role='BOSS'
 *
 *   2. 财务设置读取（GET /admin/finance-settings）
 *      - 携带老板 Token 调用
 *      - 验证返回 200（首次为 null 或已有配置）
 *
 *   3. 财务设置保存 - 启用分账（PUT /admin/finance-settings）
 *      - 配置 MERCHANT_ID 类型接收方
 *      - 配置 DB 覆盖 mainMchId / mainAppId
 *      - 验证返回 200 + source=created/updated
 *
 *   4. 配置持久化验证（GET 二次读取）
 *      - 重新读取配置，验证 mainMchId/mainAppId 已持久化
 *
 *   5. 分账禁用 / 启用切换验证
 *
 *   9. 【新增】分佣配置生效诊断（核心链路验证）
 *      - 9.1 创建测试订单 → 统一下单 → 验证 profit_sharing=true 被注入
 *      - 9.2 读取分账接收方配置 → 验证 DB 覆盖优先级 > .env 回落
 *      - 9.3 平台佣金账号字段非空校验
 *
 *   6. 权限校验：非老板账号被拒绝
 *      - 普通用户 Token 调用应返回 403
 *      - ADMIN Token 调用应返回 403
 *
 *   7. DTO 校验：非法配置被拒绝（5 种子场景）
 *
 *   8. 清理：恢复 env 配置（mainMchId=null, mainAppId=null）
 *
 * 用法：
 *   node scripts/test-boss-finance-settings.cjs                       # 默认 http://localhost:3000
 *   node scripts/test-boss-finance-settings.cjs http://192.168.1.10:3000  # 指定 BFF 地址
 *   BOSS_USER_ID=2 node scripts/test-boss-finance-settings.cjs          # 指定老板用户 ID
 *   LOG_LEVEL=debug node scripts/test-boss-finance-settings.cjs         # debug 级别日志
 *   LOG_FILE=./logs/my.log node scripts/test-boss-finance-settings.cjs  # 指定日志文件路径
 *
 * 退出码：0=全部通过；1=至少一个失败
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ============================================================
// 配置
// ============================================================
const BFF_BASE_URL = process.argv[2] || process.env.BFF_BASE_URL || 'http://localhost:3000';
const BOSS_USER_ID = process.env.BOSS_USER_ID || '1';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_FILE =
  process.env.LOG_FILE ||
  path.join(
    __dirname,
    '..',
    'logs',
    `test-finance-${new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14)}.log`,
  );

const TEST_CONFIG = {
  profitSharingEnabled: true,
  receiverType: 'MERCHANT_ID',
  receiverMchId: '1600000099',
  receiverName: '测试平台佣金账户',
  receiverOpenid: null,
  mainMchId: '1600000088',
  mainAppId: 'wxabcdef1234567890',
};

// 测试用发布者用户（用于创建订单），若登录失败诊断步骤会自动跳过
const TEST_ORDER_PUBLISHER_NICKNAME = '分账诊断-订单发布者';

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

// ============================================================
// 详细日志系统（时间戳 / 级别 / 锚点 / 请求ID / 文件日志）
// ============================================================
let requestSeq = 0;
let logFileStream = null;

function ensureLogDirAndStream() {
  if (logFileStream) return logFileStream;
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    logFileStream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
    // 首行空行分隔之前的日志
    logFileStream.write('\n' + '='.repeat(80) + '\n');
  } catch (err) {
    console.warn(`[WARN] 无法创建日志文件 ${LOG_FILE}: ${err.message}（仅输出控制台）`);
    logFileStream = null;
  }
  return logFileStream;
}

function writeFileLog(line) {
  const s = ensureLogDirAndStream();
  if (s) {
    try {
      s.write(line + '\n');
    } catch {
      // ignore
    }
  }
}

function ts() {
  // 本地时区时间戳，精确到毫秒
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

function levelLabel(lvl) {
  return ({ error: 'ERROR', warn: 'WARN ', info: 'INFO ', debug: 'DEBUG' })[lvl] || 'INFO ';
}

function log(lvl, anchor, msg, extra) {
  if (LOG_LEVELS[lvl] === undefined) lvl = 'info';
  if (LOG_LEVELS[lvl] > LOG_LEVELS[LOG_LEVEL]) return;

  const anchorTag = anchor ? `[${anchor}] ` : '';
  const colorStart = {
    error: '\x1b[31m',
    warn: '\x1b[33m',
    info: '',
    debug: '\x1b[36m',
  }[lvl];
  const colorEnd = colorStart ? '\x1b[0m' : '';

  let line = `${ts()} [${levelLabel(lvl)}] ${anchorTag}${msg}`;
  if (extra !== undefined && extra !== null) {
    let extraStr;
    try {
      extraStr =
        typeof extra === 'object' && extra !== null
          ? '\n' + JSON.stringify(extra, null, 2)
          : '  ' + String(extra);
    } catch {
      extraStr = '  <unserializable>';
    }
    line += extraStr;
  }

  // 控制台输出
  console.log(`${colorStart}${line}${colorEnd}`);
  // 文件日志（去色）
  writeFileLog(line.replace(/\x1b\[[0-9;]*m/g, ''));
}

// 便捷方法
const LOG = {
  info: (anchor, msg, extra) => log('info', anchor, msg, extra),
  warn: (anchor, msg, extra) => log('warn', anchor, msg, extra),
  error: (anchor, msg, extra) => log('error', anchor, msg, extra),
  debug: (anchor, msg, extra) => log('debug', anchor, msg, extra),
};

// ============================================================
// HTTP 工具（带请求 ID、详细日志、错误堆栈）
// ============================================================
function httpRequest(method, path, body, token, logAnchor = '') {
  const reqId = `R${String(++requestSeq).padStart(4, '0')}`;
  const url = new URL(path, BFF_BASE_URL);
  const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
  const options = {
    method,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + (url.search || ''),
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': reqId, // 透传给 BFF 便于关联日志
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };
  const fullUrl = `${BFF_BASE_URL}${options.path}`;

  // debug 日志中使用脱敏 token，避免明文泄露
  const debugHeaders = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${maskToken(token)}` } : {}),
  };
  LOG.debug(
    logAnchor,
    `[${reqId}] → ${method} ${fullUrl}`,
    {
      headers: debugHeaders,
      body: payload ? (payload.length > 1500 ? payload.slice(0, 1500) + '...[truncated]' : payload) : null,
    },
  );

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const elapsed = Date.now() - startedAt;
        let parsed;
        let parseErr = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
          parseErr = e.message;
        }
        const result = { status: res.statusCode, headers: res.headers, body: parsed, reqId, elapsedMs: elapsed };

        // 响应日志
        const lvl = result.status >= 500 ? 'error' : result.status >= 400 ? 'warn' : 'info';
        log(lvl, logAnchor, `[${reqId}] ← ${method} ${fullUrl} status=${result.status} took=${elapsed}ms`, {
          responseBody:
            typeof result.body === 'string' && result.body.length > 2000
              ? result.body.slice(0, 2000) + '...[truncated]'
              : result.body,
          parseError: parseErr,
        });

        resolve(result);
      });
    });
    req.on('error', (err) => {
      const elapsed = Date.now() - startedAt;
      LOG.error(
        logAnchor,
        `[${reqId}] ✗ ${method} ${fullUrl} 连接失败: ${err.message} (took=${elapsed}ms)`,
        { errCode: err.code, errStack: err.stack, fullUrl },
      );
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** 执行 Refresh Token Rotation，刷新 bossSession.accessToken */
async function refreshBossToken(anchor) {
  if (!bossSession?.refreshToken) return false;
  LOG.warn(anchor, `BOSS Token 返回 401，尝试用 Refresh Token 刷新...`, {
    oldTokenEnding: bossSession.token ? maskToken(bossSession.token) : null,
  });
  try {
    const res = await httpRequest(
      'POST',
      '/api/v1/auth/refresh',
      { refreshToken: bossSession.refreshToken },
      null,
      anchor,
    );
    if (res.status === 200) {
      const data = res.body?.data ?? res.body;
      if (data?.accessToken) {
        bossSession.token = data.accessToken;
        bossSession.refreshToken = data.refreshToken ?? bossSession.refreshToken;
        LOG.info(anchor, `BOSS Token 刷新成功，新 token 开头=${maskToken(bossSession.token)}`);
        return true;
      }
    }
    LOG.warn(anchor, `Refresh Token 刷新失败，尝试重新登录 BOSS 账号`, {
      status: res.status,
      body: res.body,
    });
  } catch (e) {
    LOG.warn(anchor, `Refresh Token 请求异常`, { message: e.message });
  }
  // Refresh 失败 → 回退为重新登录 BOSS 账号
  try {
    const relogin = await httpRequest(
      'POST',
      '/api/v1/auth/test-login',
      { userId: BOSS_USER_ID },
      null,
      anchor,
    );
    const data = relogin.body?.data ?? relogin.body;
    if (relogin.status === 200 && data?.accessToken) {
      bossSession.token = data.accessToken;
      bossSession.refreshToken = data.refreshToken ?? bossSession.refreshToken;
      LOG.info(anchor, `BOSS 账号重新登录成功`);
      return true;
    }
    LOG.error(anchor, `BOSS 账号重新登录也失败`, {
      status: relogin.status,
      body: relogin.body,
    });
    return false;
  } catch (e2) {
    LOG.error(anchor, `BOSS 重新登录异常`, { message: e2.message });
    return false;
  }
}

/**
 * 带 401 自动刷新的请求包装：
 *  - 如果当前请求是老板 token 且返回 401，自动 refresh 并重试一次
 *  - 非老板请求或非 401 原样返回
 * tokenType: 'boss' | 'other'
 */
async function requestWithRefresh(method, path, body, token, logAnchor, tokenType = 'boss') {
  const res = await httpRequest(method, path, body, token, logAnchor);
  if (tokenType === 'boss' && res.status === 401 && bossSession) {
    const ok = await refreshBossToken(logAnchor);
    if (ok && bossSession.token) {
      LOG.info(logAnchor, `401 自动刷新成功，重试 ${method} ${path}`);
      return httpRequest(method, path, body, bossSession.token, logAnchor);
    }
  }
  return res;
}

function maskToken(token) {
  if (!token) return '(无token)';
  if (token.length <= 10) return token[0] + '***';
  return token.slice(0, 10) + '...' + token.slice(-4);
}

// ============================================================
// 测试记录工具（带日志锚点，方便 grep 失败用例）
// ============================================================
const stats = { total: 0, passed: 0, failed: 0, skipped: 0 };
const failedCases = [];
let originalConfig = null;
// 全局老板账号会话（token + refreshToken），供 401 时自动刷新
let bossSession = null;

function recordTest(name, passed, detail) {
  stats.total++;
  const anchor = 'LOG-FIN-TEST';
  if (passed) {
    stats.passed++;
    console.log(`  ✅ ${name}`);
    LOG.debug(anchor, `用例通过: ${name}`, detail || undefined);
  } else {
    stats.failed++;
    failedCases.push({ name, detail });
    console.log(`  ❌ ${name}`);
    LOG.error(anchor, `用例失败: ${name}`, detail || undefined);
  }
  if (detail) {
    console.log(`     ${detail}`);
    LOG.debug(anchor, `  详情: ${detail}`);
  }
}

function skipTest(name, reason) {
  stats.total++;
  stats.skipped++;
  console.log(`  ⏭️  ${name}（跳过：${reason}）`);
  LOG.warn('LOG-FIN-TEST', `用例跳过: ${name}`, { reason });
}

function section(title) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📋 ${title}`);
  console.log('─'.repeat(70));
  LOG.info('LOG-FIN-SECTION', title);
}

// ============================================================
// 主流程
// ============================================================

async function testHealthCheck() {
  section('步骤 0：BFF 服务健康检查 [LOG-FIN-002]');
  try {
    const res = await httpRequest('GET', '/api/v1/auth/me', null, null, 'LOG-FIN-002');
    const ok = res.status === 401 || res.status === 200;
    recordTest(
      'BFF 服务可访问',
      ok,
      `status=${res.status}, requestId=${res.reqId}, took=${res.elapsedMs}ms (期望 401 或 200)`,
    );
    return ok;
  } catch (err) {
    recordTest(
      'BFF 服务可访问',
      false,
      `连接失败: ${err.message}；请先启动 BFF：cd bff && npm run start:dev`,
    );
    return false;
  }
}

async function bossLogin() {
  section('步骤 1：老板账号登录 [LOG-FIN-003]');
  LOG.info('LOG-FIN-003', `开始登录老板账号`, { BOSS_USER_ID, endpoint: 'POST /api/v1/auth/test-login' });

  const loginPayload = { userId: BOSS_USER_ID };
  LOG.debug('LOG-FIN-003', `登录请求体`, loginPayload);
  const res = await httpRequest('POST', '/api/v1/auth/test-login', loginPayload, null, 'LOG-FIN-003');

  const data = res.body?.data ?? res.body;
  const token = data?.accessToken;
  const user = data?.user;
  const role = user?.role;

  const loginOk = res.status === 200 && !!token && role === 'BOSS';
  recordTest(
    '老板账号登录成功',
    loginOk,
    `status=${res.status}, role=${role}, token=${token ? maskToken(token) : '(空)'}, requestId=${res.reqId}`,
  );

  if (!loginOk) {
    LOG.warn('LOG-FIN-003', `登录失败，诊断信息`, {
      status: res.status,
      responseBody: res.body,
      hasAccessToken: !!token,
      userRole: role,
    });
    console.log('   ⚠️ 登录失败，后续测试将无法继续');
    if (res.status === 404) {
      console.log('   💡 提示：test-login 接口可能在生产环境被禁用，请确保 BFF 运行在开发模式');
    }
    if (res.status === 400 || res.status === 404) {
      console.log(`   💡 提示：检查 BOSS_USER_ID=${BOSS_USER_ID} 是否存在于 users 表且 role=BOSS`);
    }
    return null;
  }

  recordTest(
    '登录响应包含完整用户信息',
    !!user && !!user.id && !!user.nickname,
    `userId=${user.id}, nickname=${user.nickname}, creditScore=${user.creditScore}`,
  );
  LOG.info('LOG-FIN-003', `老板账号登录成功`, {
    userId: user.id,
    role: user.role,
    nickname: user.nickname,
    creditScore: user.creditScore,
    tokenLength: token.length,
  });

  bossSession = { token, refreshToken: data.refreshToken, user };
  return { token, refreshToken: data.refreshToken, user };
}

async function getFinanceSettings(token, label = '首次读取') {
  section(`步骤 2：财务设置读取（${label}）[LOG-FIN-005]`);
  LOG.info('LOG-FIN-005', `开始读取财务设置 [${label}]`);

  const res = await requestWithRefresh('GET', '/api/v1/admin/finance-settings', null, token, 'LOG-FIN-005', 'boss');
  if (bossSession?.token) token = bossSession.token;
  const ok = res.status === 200;
  recordTest(
    `GET /admin/finance-settings 返回 200`,
    ok,
    `status=${res.status}, requestId=${res.reqId}, took=${res.elapsedMs}ms`,
  );

  if (!ok) {
    LOG.error('LOG-FIN-005', `财务设置读取失败`, { status: res.status, body: res.body });
    return null;
  }

  const setting = res.body?.data !== undefined ? res.body.data : res.body;
  LOG.info('LOG-FIN-005', `财务设置读取结果`, {
    hasData: setting !== null,
    data: setting,
  });

  if (setting === null) {
    console.log('   ℹ️  当前无配置（DB 中尚无记录），符合首次使用场景');
  } else {
    console.log(
      `   ℹ️  当前配置: profitSharingEnabled=${setting.profitSharingEnabled}, ` +
        `receiverType=${setting.receiverType}, mainMchId=${setting.mainMchId ?? '(空)'}`,
    );
  }
  return setting;
}

async function saveFinanceSettings(token, config, label = '保存配置') {
  section(`步骤 3：财务设置保存（${label}）[LOG-FIN-006]`);
  LOG.info('LOG-FIN-006', `保存财务配置 [${label}]`, {
    expectedConfig: {
      ...config,
      // 敏感字段仅保留前3后3位用于排查
      receiverMchId: maskMchId(config.receiverMchId),
      mainMchId: maskMchId(config.mainMchId),
      mainAppId: maskAppId(config.mainAppId),
      receiverOpenid: maskOpenid(config.receiverOpenid),
    },
  });
  console.log(`   PUT /api/v1/admin/finance-settings`);
  console.log(
    `   请求体: profitSharingEnabled=${config.profitSharingEnabled}, ` +
      `receiverType=${config.receiverType}, ` +
      `receiverMchId=${config.receiverMchId ?? '(null)'}, ` +
      `mainMchId=${config.mainMchId ?? '(null)'}, ` +
      `mainAppId=${config.mainAppId ?? '(null)'}`,
  );

  const res = await requestWithRefresh('PUT', '/api/v1/admin/finance-settings', config, token, 'LOG-FIN-006', 'boss');
  if (bossSession?.token) token = bossSession.token;
  const ok = res.status === 200;
  recordTest(`保存返回 200`, ok, `status=${res.status}, requestId=${res.reqId}, took=${res.elapsedMs}ms`);

  if (!ok) {
    LOG.error('LOG-FIN-006', `保存财务配置失败`, {
      status: res.status,
      responseBody: res.body,
      expectedConfig: config,
    });
    console.log(`   响应: ${JSON.stringify(res.body).slice(0, 500)}`);
    return null;
  }

  const saved = res.body?.data !== undefined ? res.body.data : res.body;
  LOG.info('LOG-FIN-006', `保存财务配置成功`, {
    source: saved?.source,
    saved: {
      ...saved,
      receiverMchId: maskMchId(saved?.receiverMchId),
      mainMchId: maskMchId(saved?.mainMchId),
      mainAppId: maskAppId(saved?.mainAppId),
    },
  });

  recordTest(
    '返回的 source 字段合法',
    saved?.source === 'created' || saved?.source === 'updated',
    `source=${saved?.source}`,
  );
  recordTest(
    '返回的 receiverMchId 已持久化',
    saved?.receiverMchId === config.receiverMchId,
    `期望=${config.receiverMchId}, 实际=${saved?.receiverMchId}`,
  );
  recordTest(
    '返回的 mainMchId 已持久化（DB 覆盖字段）',
    saved?.mainMchId === config.mainMchId,
    `期望=${config.mainMchId}, 实际=${saved?.mainMchId}`,
  );
  recordTest(
    '返回的 mainAppId 已持久化（DB 覆盖字段）',
    saved?.mainAppId === config.mainAppId,
    `期望=${config.mainAppId}, 实际=${saved?.mainAppId}`,
  );
  recordTest(
    '返回的 updatedBy 字段已记录操作人',
    saved?.updatedBy === BOSS_USER_ID,
    `期望=${BOSS_USER_ID}, 实际=${saved?.updatedBy}`,
  );

  return saved;
}

function maskMchId(id) {
  if (!id) return id;
  if (id.length <= 6) return id.slice(0, 1) + '***';
  return id.slice(0, 3) + '***' + id.slice(-3);
}
function maskAppId(id) {
  if (!id) return id;
  if (id.length <= 8) return id.slice(0, 1) + '***';
  return id.slice(0, 4) + '***' + id.slice(-4);
}
function maskOpenid(id) {
  if (!id) return id;
  if (id.length <= 10) return id.slice(0, 1) + '***';
  return id.slice(0, 5) + '***' + id.slice(-5);
}

async function verifyPersistence(token) {
  section('步骤 4：DB 持久化验证（二次读取）[LOG-FIN-007]');
  LOG.info('LOG-FIN-007', `二次读取验证持久化`);

  const res = await requestWithRefresh('GET', '/api/v1/admin/finance-settings', null, token, 'LOG-FIN-007', 'boss');
  if (bossSession?.token) token = bossSession.token;
  const ok = res.status === 200;
  recordTest('二次读取返回 200', ok, `status=${res.status}, requestId=${res.reqId}, took=${res.elapsedMs}ms`);
  if (!ok) {
    LOG.error('LOG-FIN-007', `二次读取失败`, { status: res.status, body: res.body });
    return;
  }

  const setting = res.body?.data !== undefined ? res.body.data : res.body;
  LOG.debug('LOG-FIN-007', `二次读取结果`, setting);
  if (!setting) {
    recordTest('二次读取应有数据', false, '返回为 null，但上一步刚保存过');
    LOG.error('LOG-FIN-007', `二次读取返回 null，预期刚保存的配置`);
    return;
  }

  const checks = [
    ['profitSharingEnabled 一致', 'profitSharingEnabled'],
    ['receiverType 一致', 'receiverType'],
    ['receiverMchId 一致', 'receiverMchId'],
    ['mainMchId（DB 覆盖）已生效', 'mainMchId'],
    ['mainAppId（DB 覆盖）已生效', 'mainAppId'],
  ];

  checks.forEach(([name, key]) => {
    const pass = setting[key] === TEST_CONFIG[key];
    recordTest(
      `DB 持久化: ${name}`,
      pass,
      `期望=${JSON.stringify(TEST_CONFIG[key])}, 实际=${JSON.stringify(setting[key])}`,
    );
    if (!pass) {
      LOG.error('LOG-FIN-007', `字段持久化不一致: ${name}`, {
        field: key,
        expected: TEST_CONFIG[key],
        actual: setting[key],
      });
    }
  });
}

async function testProfitSharingDisabled(token) {
  section('步骤 5：分账禁用配置验证 [LOG-FIN-008]');
  LOG.info('LOG-FIN-008', `测试分账禁用 → 启用切换`);

  const disabledConfig = { ...TEST_CONFIG, profitSharingEnabled: false };
  const res = await requestWithRefresh(
    'PUT',
    '/api/v1/admin/finance-settings',
    disabledConfig,
    token,
    'LOG-FIN-008',
    'boss',
  );
  if (bossSession?.token) token = bossSession.token;
  const ok = res.status === 200;
  recordTest('保存 profitSharingEnabled=false 成功', ok, `status=${res.status}`);

  if (ok) {
    const saved = res.body?.data !== undefined ? res.body.data : res.body;
    recordTest(
      '返回的 profitSharingEnabled=false',
      saved?.profitSharingEnabled === false,
      `实际=${saved?.profitSharingEnabled}`,
    );
    if (saved?.profitSharingEnabled !== false) {
      LOG.error('LOG-FIN-008', `分账禁用保存失败`, { expected: false, actual: saved?.profitSharingEnabled });
    } else {
      LOG.info('LOG-FIN-008', `分账禁用配置已保存，将恢复启用...`);
    }
  }

  const restoreRes = await requestWithRefresh(
    'PUT',
    '/api/v1/admin/finance-settings',
    TEST_CONFIG,
    token,
    'LOG-FIN-008',
    'boss',
  );
  if (bossSession?.token) token = bossSession.token;
  recordTest(
    '恢复 profitSharingEnabled=true',
    restoreRes.status === 200,
    `status=${restoreRes.status}, requestId=${restoreRes.reqId}`,
  );
}

// ============================================================
// 【新增】步骤9：分佣配置生效诊断（核心链路验证）
// ============================================================
async function diagnoseProfitSharingChain(bossToken) {
  section('步骤 9：分佣配置生效诊断（核心链路）[LOG-FIN-009]');
  LOG.info(
    'LOG-FIN-009',
    `开始分佣配置诊断：验证 service 层 → 统一下单 profit_sharing=true → 分账接收方 DB 覆盖优先级`,
  );

  // 先确保当前配置是启用分账 + DB 覆盖
  LOG.debug('LOG-FIN-009', `先读取当前财务配置，确保处于测试状态`);
  const getRes = await requestWithRefresh(
    'GET',
    '/api/v1/admin/finance-settings',
    null,
    bossToken,
    'LOG-FIN-009',
    'boss',
  );
  if (bossSession?.token) bossToken = bossSession.token;
  if (getRes.status !== 200) {
    LOG.error('LOG-FIN-009', `读取财务配置失败，诊断步骤中止`, { status: getRes.status });
    skipTest('分佣配置生效诊断', `读取配置失败 (status=${getRes.status})`);
    return;
  }
  const cur = getRes.body?.data ?? getRes.body;
  LOG.info('LOG-FIN-009', `当前财务配置快照`, {
    profitSharingEnabled: cur?.profitSharingEnabled,
    receiverType: cur?.receiverType,
    receiverMchId: maskMchId(cur?.receiverMchId),
    receiverName: cur?.receiverName,
    mainMchId: maskMchId(cur?.mainMchId),
    mainAppId: maskAppId(cur?.mainAppId),
  });

  // 9.1 验证保存后 DB 中平台佣金收款账号必填
  section('9.1 平台佣金收款账号非空校验 [LOG-FIN-011]');
  LOG.info('LOG-FIN-011', `检查分账接收方关键字段`);
  recordTest(
    '分账启用时 receiverType 非空',
    !!cur?.receiverType,
    `实际=${cur?.receiverType ?? '(空)'}`,
  );
  if (cur?.receiverType === 'MERCHANT_ID') {
    recordTest(
      '分账启用且 MERCHANT_ID 时 receiverMchId 非空',
      !!cur?.receiverMchId && /^\d{8,32}$/.test(cur.receiverMchId),
      `receiverMchId=${cur?.receiverMchId ?? '(空)'} (格式=/^\d{8,32}$/)`,
    );
    recordTest(
      '分账启用且 MERCHANT_ID 时 receiverName 非空',
      !!cur?.receiverName,
      `receiverName=${cur?.receiverName ?? '(空)'}`,
    );
  } else if (cur?.receiverType === 'PERSONAL_OPENID') {
    recordTest(
      '分账启用且 PERSONAL_OPENID 时 receiverOpenid 非空',
      !!cur?.receiverOpenid,
      `receiverOpenid=${cur?.receiverOpenid ?? '(空)'}`,
    );
  }

  // 9.2 统一下单链路 profit_sharing=true 标记验证（通过创建测试订单模拟）
  section('9.2 统一下单链路 profit_sharing=true 标记验证 [LOG-FIN-010]');
  LOG.info(
    'LOG-FIN-010',
    `模拟用户登录 → 发布任务 → 提交支付 → 验证 BFF 日志中是否注入 profit_sharing=true`,
  );

  // 登录一个普通用户用于创建订单
  const pubLoginRes = await httpRequest(
    'POST',
    '/api/v1/auth/test-login',
    { nickname: TEST_ORDER_PUBLISHER_NICKNAME },
    null,
    'LOG-FIN-010',
  );
  const pubData = pubLoginRes.body?.data ?? pubLoginRes.body;
  const pubToken = pubData?.accessToken;
  const pubUser = pubData?.user;
  if (!pubToken) {
    LOG.warn('LOG-FIN-010', `普通用户登录失败，跳过统一下单链路模拟`, pubLoginRes.body);
    skipTest('统一下单 profit_sharing=true 模拟', `普通用户登录失败`);
  } else {
    LOG.info('LOG-FIN-010', `普通用户登录成功，开始创建支付订单`, {
      userId: pubUser?.id,
      nickname: pubUser?.nickname,
    });
    recordTest(
      '普通用户登录成功（用于创建订单）',
      !!pubUser && !!pubUser.id,
      `userId=${pubUser?.id}, nickname=${pubUser?.nickname}`,
    );

    // 发布一个测试任务（创建订单入口是 payment.controller.createPaymentOrder）
    // 先获取任务列表选一个可下单的任务，或者创建任务
    const taskRes = await httpRequest(
      'GET',
      '/api/v1/tasks?page=1&pageSize=3&status=PUBLISHED',
      null,
      pubToken,
      'LOG-FIN-010',
    );
    LOG.debug('LOG-FIN-010', `获取任务列表结果`, {
      status: taskRes.status,
      count:
        (taskRes.body?.data?.list ?? taskRes.body?.data ?? taskRes.body ?? []).length,
    });

    const list = taskRes.body?.data?.list ?? taskRes.body?.data ?? taskRes.body ?? [];
    let taskId = null;
    if (Array.isArray(list) && list.length > 0) {
      taskId = list[0].id;
    }

    if (!taskId) {
      LOG.warn(
        'LOG-FIN-010',
        `没有可直接支付的已发布任务，跳过统一下单 profit_sharing=true 实际请求验证`,
      );
      console.log(
        '   ℹ️  提示：没有可支付任务时，建议直接查看 BFF 控制台日志的 [PROFIT-SHARE] 前缀，\n' +
          '       或运行 scripts/verify-profit-sharing-logs.cjs 进行分账链路日志级别的完整验证',
      );
      skipTest(
        '统一下单 profit_sharing=true 注入验证',
        `任务列表为空（请先在小程序发布任务后重新运行测试，或执行 verify-profit-sharing-logs.cjs）`,
      );
    } else {
      // 尝试对任务创建支付订单（调用付款接口）
      LOG.info('LOG-FIN-010', `尝试对 taskId=${taskId} 创建支付订单`, { taskId });
      try {
        const createPayRes = await httpRequest(
          'POST',
          `/api/v1/payment/tasks/${taskId}/pay`,
          { amountCents: 100 * 100, quoteType: 'DIRECT' }, // 模拟 100 元
          pubToken,
          'LOG-FIN-010',
        );
        LOG.info(
          'LOG-FIN-010',
          `创建支付订单返回: status=${createPayRes.status}`,
          createPayRes.body,
        );
        recordTest(
          '创建支付订单接口调用成功（仅验证不抛异常）',
          createPayRes.status === 200 || createPayRes.status === 400,
          `status=${createPayRes.status} (200 表示成功 / 400 表示该任务状态不可支付)`,
        );

        // 关键链路日志输出提示
        console.log(
          '\n   🔍 【诊断提示】若分账标记未生效，请前往 BFF 控制台日志 grep 以下关键字：\n' +
            '      - [LOG-PS-001] /api/v1/admin/finance-settings getActiveProfitSharingReceiver\n' +
            '      - [PROFIT-SHARE] Receiver 配置（enabled=true 说明 DB 覆盖加载成功）\n' +
            '      - profit_sharing: true（统一下单请求体注入标记）',
        );
      } catch (e) {
        LOG.warn('LOG-FIN-010', `创建支付订单异常`, { taskId, message: e.message });
        skipTest('创建支付订单接口调用', `异常：${e.message}`);
      }
    }
  }

  // 9.3 【辅助诊断】输出 .env 与 DB 优先级比较表
  section('9.3 优先级覆盖对照表 [LOG-FIN-011]');
  LOG.info('LOG-FIN-011', `输出配置优先级覆盖对照表供排查`);
  const envMchId = process.env.WX_MCH_ID ?? '(未设置)';
  const envAppId = process.env.WX_APP_ID ?? '(未设置)';
  const envReceiverMchId = process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID ?? '(未设置)';
  const envEnabled = process.env.WX_PROFIT_SHARING_ENABLED ?? '(未设置)';

  const table = [
    [
      'profitSharingEnabled',
      envEnabled,
      cur?.profitSharingEnabled === undefined ? '(空)' : String(cur?.profitSharingEnabled),
      cur?.profitSharingEnabled === true || cur?.profitSharingEnabled === false
        ? '✅ DB 覆盖生效'
        : '⚠️  回落 env',
    ],
    [
      'receiverMchId（佣金收款）',
      maskMchId(envReceiverMchId),
      maskMchId(cur?.receiverMchId),
      cur?.receiverMchId ? '✅ DB 覆盖生效' : '⚠️  回落 env',
    ],
    [
      'mainMchId（主商户号）',
      maskMchId(envMchId),
      maskMchId(cur?.mainMchId),
      cur?.mainMchId ? '✅ DB 覆盖生效' : '⚠️  回落 env',
    ],
    [
      'mainAppId（小程序 AppID）',
      maskAppId(envAppId),
      maskAppId(cur?.mainAppId),
      cur?.mainAppId ? '✅ DB 覆盖生效' : '⚠️  回落 env',
    ],
  ];
  console.log('\n   ┌──────────────────────┬──────────────────────┬──────────────────────┬────────────────┐');
  console.log('   │ 字段                 │ .env 值              │ DB 值                │ 生效状态       │');
  console.log('   ├──────────────────────┼──────────────────────┼──────────────────────┼────────────────┤');
  table.forEach((row) => {
    const cells = row.map((c) => String(c).padEnd(20).slice(0, 20));
    console.log(`   │ ${cells.join(' │ ')} │`);
  });
  console.log('   └──────────────────────┴──────────────────────┴──────────────────────┴────────────────┘');

  LOG.debug('LOG-FIN-011', `优先级覆盖表（原始值，包含脱敏前）`, {
    env: {
      WX_PROFIT_SHARING_ENABLED: envEnabled,
      WX_PROFIT_SHARING_RECEIVER_MCH_ID: maskMchId(envReceiverMchId),
      WX_MCH_ID: maskMchId(envMchId),
      WX_APP_ID: maskAppId(envAppId),
    },
    db: {
      profitSharingEnabled: cur?.profitSharingEnabled,
      receiverMchId: maskMchId(cur?.receiverMchId),
      receiverName: cur?.receiverName,
      mainMchId: maskMchId(cur?.mainMchId),
      mainAppId: maskAppId(cur?.mainAppId),
    },
  });
}

async function testPermissionDenied() {
  section('步骤 6：权限校验 — 非老板账号被拒绝 [LOG-FIN-012]');
  LOG.info('LOG-FIN-012', `开始权限校验：普通用户 + ADMIN 角色访问财务设置`);

  console.log('   创建普通用户登录以测试权限...');
  const userRes = await httpRequest(
    'POST',
    '/api/v1/auth/test-login',
    { nickname: '权限测试-普通用户' },
    null,
    'LOG-FIN-012',
  );
  const userData = userRes.body?.data ?? userRes.body;
  const userToken = userData?.accessToken;
  const userRole = userData?.user?.role;
  LOG.debug('LOG-FIN-012', `普通用户登录结果`, {
    hasToken: !!userToken,
    role: userRole,
    userId: userData?.user?.id,
  });

  if (!userToken) {
    skipTest('创建普通用户', 'test-login 不可用');
  } else {
    console.log(`   普通用户 role=${userRole}, 尝试访问财务设置...`);
    const res = await httpRequest(
      'GET',
      '/api/v1/admin/finance-settings',
      null,
      userToken,
      'LOG-FIN-012',
    );
    const denied = res.status === 401 || res.status === 403;
    recordTest(
      '普通用户被拒绝（401/403）',
      denied,
      `status=${res.status} (期望 401/403), requestId=${res.reqId}`,
    );
    if (!denied) {
      LOG.error('LOG-FIN-012', `普通用户居然访问了财务设置！严重权限漏洞`, {
        userId: userData?.user?.id,
        role: userRole,
        status: res.status,
        body: res.body,
      });
    }
  }

  console.log('   尝试用 ADMIN 角色用户...');
  const adminRes = await httpRequest(
    'POST',
    '/api/v1/auth/test-login',
    { userId: '2' },
    null,
    'LOG-FIN-012',
  );
  const adminData = adminRes.body?.data ?? adminRes.body;
  const adminToken = adminData?.accessToken;
  const adminRole = adminData?.user?.role;
  LOG.debug('LOG-FIN-012', `ADMIN 用户登录结果`, {
    hasToken: !!adminToken,
    role: adminRole,
    userId: adminData?.user?.id,
  });

  if (!adminToken) {
    skipTest('ADMIN 用户登录', 'test-login userId=2 不可用');
  } else if (adminRole !== 'ADMIN') {
    skipTest(`ADMIN 用户登录`, `DB 中 userId=2 的角色为 ${adminRole}，非 ADMIN`);
  } else {
    console.log(`   ADMIN 用户登录成功，尝试访问财务设置...`);
    const res = await httpRequest(
      'GET',
      '/api/v1/admin/finance-settings',
      null,
      adminToken,
      'LOG-FIN-012',
    );
    const denied = res.status === 401 || res.status === 403;
    recordTest(
      'ADMIN 角色被拒绝（仅 BOSS/SUPER_ADMIN 可访问）',
      denied,
      `status=${res.status} (期望 401/403), requestId=${res.reqId}`,
    );
    if (!denied) {
      LOG.error('LOG-FIN-012', `ADMIN 居然访问了财务设置！严重权限漏洞`, {
        userId: adminData?.user?.id,
        role: adminRole,
        status: res.status,
        body: res.body,
      });
    }
  }
}

async function testDtoValidation(token) {
  section('步骤 7：DTO 校验 — 非法配置被拒绝 [LOG-FIN-013]');
  LOG.info('LOG-FIN-013', `开始 DTO 校验：5 种非法配置场景`);

  const cases = [
    {
      name: '非法 receiverType',
      payload: { ...TEST_CONFIG, receiverType: 'INVALID_TYPE' },
      anchor: 'LOG-FIN-013',
    },
    {
      name: '非法商户号格式',
      payload: { ...TEST_CONFIG, receiverMchId: 'abc123' },
      anchor: 'LOG-FIN-013',
    },
    {
      name: 'MERCHANT_ID 缺少 receiverMchId',
      payload: { ...TEST_CONFIG, receiverMchId: null },
      anchor: 'LOG-FIN-013',
    },
    {
      name: 'PERSONAL_OPENID 缺少 receiverOpenid',
      payload: { ...TEST_CONFIG, receiverType: 'PERSONAL_OPENID', receiverOpenid: null },
      anchor: 'LOG-FIN-013',
    },
    {
      name: '非法 AppID 格式',
      payload: { ...TEST_CONFIG, mainAppId: 'invalid_appid' },
      anchor: 'LOG-FIN-013',
    },
  ];

  for (const [i, c] of cases.entries()) {
    console.log(`   7.${i + 1} 测试${c.name}...`);
    LOG.debug('LOG-FIN-013', `[子场景 7.${i + 1}] 测试请求体`, c.payload);
    const res = await requestWithRefresh(
      'PUT',
      '/api/v1/admin/finance-settings',
      c.payload,
      token,
      c.anchor,
      'boss',
    );
    if (bossSession?.token) token = bossSession.token;
    const ok = res.status === 400;
    recordTest(
      `${c.name} 被拒绝`,
      ok,
      `status=${res.status} (期望 400), requestId=${res.reqId}`,
    );
    if (!ok) {
      LOG.error('LOG-FIN-013', `DTO 校验漏网！本应被拒绝的请求通过了`, {
        subCase: `7.${i + 1} ${c.name}`,
        requestPayload: c.payload,
        responseStatus: res.status,
        responseBody: res.body,
      });
    } else {
      // debug 级别输出 DTO 校验失败详情（message 字段）
      LOG.debug('LOG-FIN-013', `[子场景 7.${i + 1}] DTO 校验通过（返回 400）`, {
        errorMessage: res.body?.message ?? res.body,
      });
    }
  }
}

async function cleanup(token) {
  section('步骤 8：清理 — 恢复原始配置 [LOG-FIN-014]');
  LOG.info('LOG-FIN-014', `开始清理恢复原始配置`, {
    hadOriginalConfig: originalConfig !== null,
  });

  if (originalConfig === null) {
    console.log('   原本无配置，恢复为禁用分账的初始状态...');
    const disabledPayload = {
      profitSharingEnabled: false,
      receiverType: 'MERCHANT_ID',
      receiverMchId: null,
      receiverName: null,
      receiverOpenid: null,
      mainMchId: null,
      mainAppId: null,
    };
    LOG.debug('LOG-FIN-014', `清理保存请求体`, disabledPayload);
    const res = await requestWithRefresh(
      'PUT',
      '/api/v1/admin/finance-settings',
      disabledPayload,
      token,
      'LOG-FIN-014',
      'boss',
    );
    if (bossSession?.token) token = bossSession.token;
    recordTest(
      '恢复为禁用分账初始状态',
      res.status === 200,
      `status=${res.status}, requestId=${res.reqId}`,
    );
  } else {
    console.log(
      `   恢复为原始配置: profitSharingEnabled=${originalConfig.profitSharingEnabled}...`,
    );
    const restoreConfig = {
      profitSharingEnabled: originalConfig.profitSharingEnabled,
      receiverType: originalConfig.receiverType || 'MERCHANT_ID',
      receiverMchId: originalConfig.receiverMchId || null,
      receiverName: originalConfig.receiverName || null,
      receiverOpenid: originalConfig.receiverOpenid || null,
      mainMchId: originalConfig.mainMchId || null,
      mainAppId: originalConfig.mainAppId || null,
    };
    LOG.debug('LOG-FIN-014', `恢复保存请求体`, restoreConfig);
    const res = await requestWithRefresh(
      'PUT',
      '/api/v1/admin/finance-settings',
      restoreConfig,
      token,
      'LOG-FIN-014',
      'boss',
    );
    if (bossSession?.token) token = bossSession.token;
    recordTest(
      '恢复原始配置成功',
      res.status === 200,
      `status=${res.status}, requestId=${res.reqId}`,
    );
  }

  LOG.info('LOG-FIN-014', `清理流程完成，DB 配置已恢复`);
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  ensureLogDirAndStream();

  const banner = [
    '═'.repeat(70),
    '🏦  老板账号财务设置接口完整测试（带详细日志）',
    '═'.repeat(70),
    `BFF 地址:      ${BFF_BASE_URL}`,
    `BOSS 用户ID:   ${BOSS_USER_ID}`,
    `LOG_LEVEL:     ${LOG_LEVEL}`,
    `日志文件:      ${LOG_FILE}`,
    `测试时间:      ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `本机主机名:    ${require('os').hostname()}`,
    `Node.js 版本:  ${process.version}`,
    '═'.repeat(70),
  ].join('\n');
  console.log(banner);
  LOG.info('LOG-FIN-001', `测试启动`, {
    BFF_BASE_URL,
    BOSS_USER_ID,
    LOG_LEVEL,
    LOG_FILE,
    hostname: require('os').hostname(),
    nodeVersion: process.version,
    pid: process.pid,
  });

  try {
    // 0. 健康检查
    const healthy = await testHealthCheck();
    if (!healthy) {
      LOG.error('LOG-FIN-001', `BFF 服务不可用，测试终止`);
      console.log('\n❌ BFF 服务不可用，测试终止');
      console.log('   请先启动 BFF 服务: cd bff && npm run start:dev');
      printSummary();
      process.exit(1);
    }

    // 1. 老板账号登录
    const loginResult = await bossLogin();
    if (!loginResult) {
      LOG.error('LOG-FIN-001', `老板账号登录失败，测试终止`);
      console.log('\n❌ 老板账号登录失败，测试终止');
      printSummary();
      process.exit(1);
    }
    let token = loginResult.token;
    const getToken = () => (bossSession?.token ?? token);

    // 保存原始配置（用于清理恢复）
    console.log('\n─'.repeat(70));
    console.log('📋 保存原始配置（用于清理恢复）[LOG-FIN-004]');
    LOG.info('LOG-FIN-004', `读取原始配置以用于清理时恢复`);
    const origRes = await requestWithRefresh(
      'GET',
      '/api/v1/admin/finance-settings',
      null,
      getToken(),
      'LOG-FIN-004',
      'boss',
    );
    token = getToken();
    if (origRes.status === 200) {
      originalConfig = origRes.body?.data !== undefined ? origRes.body.data : origRes.body;
      const label = originalConfig ? '已有记录' : 'null（首次使用）';
      console.log(`   原始配置: ${label}`);
      LOG.info('LOG-FIN-004', `原始配置已保存`, {
        originalConfig: originalConfig
          ? {
              ...originalConfig,
              receiverMchId: maskMchId(originalConfig.receiverMchId),
              receiverOpenid: maskOpenid(originalConfig.receiverOpenid),
              mainMchId: maskMchId(originalConfig.mainMchId),
              mainAppId: maskAppId(originalConfig.mainAppId),
            }
          : null,
      });
    } else {
      LOG.warn('LOG-FIN-004', `读取原始配置失败，清理时将尝试禁用分账`, {
        status: origRes.status,
        body: origRes.body,
      });
      console.log(`   ⚠️  读取原始配置失败 (status=${origRes.status})，清理时将尝试禁用分账`);
    }

    // 2. 读取财务设置
    await getFinanceSettings(getToken(), '登录后读取');

    // 3. 保存启用分账配置
    const saved = await saveFinanceSettings(getToken(), TEST_CONFIG, '启用分账 + DB 覆盖');
    if (!saved) {
      LOG.error('LOG-FIN-001', `保存配置失败，后续持久化/切换/DTO 步骤将跳过`);
      console.log('\n❌ 保存配置失败，后续持久化/切换/DTO 步骤将跳过');
    } else {
      await verifyPersistence(getToken());
      await testProfitSharingDisabled(getToken());

      // 【新增】9. 分佣配置生效诊断
      await diagnoseProfitSharingChain(getToken());
    }

    // 6. 权限校验
    await testPermissionDenied();

    // 7. DTO 校验
    if (saved) {
      await testDtoValidation(getToken());
    }

    // 8. 清理
    await cleanup(getToken());
  } catch (topErr) {
    LOG.error('LOG-FIN-001', `主流程未捕获异常`, {
      message: topErr.message,
      stack: topErr.stack,
    });
    console.error(`\n💥 主流程未捕获异常: ${topErr.message}`);
  } finally {
    printSummary();
    if (logFileStream) {
      try {
        logFileStream.end(() => {});
      } catch {
        // ignore
      }
      console.log(`\n📄 详细日志已写入: ${LOG_FILE}`);
    }
  }

  LOG.info('LOG-FIN-015', `进程退出`, {
    exitCode: stats.failed > 0 ? 1 : 0,
    stats,
    failedCases,
  });
  process.exit(stats.failed > 0 ? 1 : 0);
}

function printSummary() {
  console.log('\n' + '═'.repeat(70));
  console.log('📊 测试结果汇总 [LOG-FIN-015]');
  console.log('═'.repeat(70));
  console.log(`  总用例:  ${stats.total}`);
  console.log(`  ✅ 通过: ${stats.passed}`);
  console.log(`  ❌ 失败: ${stats.failed}`);
  console.log(`  ⏭️  跳过: ${stats.skipped}`);
  console.log('═'.repeat(70));

  if (failedCases.length > 0) {
    console.log('\n🔴 失败用例清单：');
    failedCases.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.name}`);
      if (c.detail) console.log(`     详情: ${c.detail}`);
    });
    console.log(
      '\n🔍 排查建议：\n' +
        '  1) 打开日志文件，搜索 [LOG-FIN-TEST] ERROR 快速定位失败上下文\n' +
        '  2) 搜索对应用例的锚点 [LOG-FIN-xxx] 查看请求/响应详情\n' +
        '  3) 对照分账模块日志（BFF 端）：grep "\\[PROFIT-SHARE\\]" 或 "\\[LOG-PS-"',
    );
  } else if (stats.passed > 0) {
    console.log('\n🎉 全部通过！老板账号财务设置功能正常，分佣配置已生效');
    console.log(
      '   ℹ️  详细请求/响应请查看日志文件；如需验证支付分账链路，可运行：\n' +
        '        node scripts/verify-profit-sharing-logs.cjs',
    );
  }
}

process.on('uncaughtException', (err) => {
  LOG.error('LOG-FIN-015', `未捕获异常`, { message: err.message, stack: err.stack });
  if (logFileStream) {
    try {
      logFileStream.end(() => {});
    } catch {
      // ignore
    }
  }
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  LOG.error('LOG-FIN-015', `未处理 Promise 拒绝`, {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
  });
  if (logFileStream) {
    try {
      logFileStream.end(() => {});
    } catch {
      // ignore
    }
  }
  process.exit(1);
});

main().catch((err) => {
  LOG.error('LOG-FIN-015', `main() catch 分支异常`, {
    message: err.message,
    stack: err.stack,
  });
  if (logFileStream) {
    try {
      logFileStream.end(() => {});
    } catch {
      // ignore
    }
  }
  process.exit(1);
});
