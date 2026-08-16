/**
 * 认证门控逻辑测试脚本
 *
 * 功能：
 *   1. 创建 4 个 mock 用户，分别对应不同认证状态：
 *      - A: 未认证用户（裸账号，无任何绑定）
 *      - B: 仅绑定手机号
 *      - C: 手机号 + 实名认证（缺银行卡）
 *      - D: 全部认证完成（手机号 + 银行卡 + 实名认证）
 *   2. 依次对每个用户测试以下接口：
 *      - GET  /verification/status   (查看认证状态)
 *      - POST /tasks                  (发布任务，应被 A/B/C 拦截)
 *      - POST /tasks/:id/accept       (接单，应被 A/B/C 拦截)
 *      - POST /wallet/withdraw        (提现，应被 A/B/C 拦截)
 *
 * 使用方法：
 *   1. 确保 MySQL + Redis 已启动 (docker compose up -d mysql redis)
 *   2. 确保后端服务已启动：cd bff && npm run start:dev
 *   3. 执行：node scripts/test-verification-gating.cjs
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000/api/v1';

// ============ HTTP 请求工具 ============
function request(method, urlPath, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    // 注意：new URL('/path', 'http://host/api/v1') 会把 /path 当绝对路径，
    // 丢掉 /api/v1 前缀。因此用字符串拼接保证前缀完整。
    const fullUrl = BASE_URL + (urlPath.startsWith('/') ? urlPath : '/' + urlPath);
    const url = new URL(fullUrl);
    const body = data ? JSON.stringify(data) : '';

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(raw) });
        } catch (e) {
          reject(new Error(`JSON 解析失败 (status=${res.statusCode}): ${raw.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ============ 颜色输出 ============
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function logPass(msg) {
  console.log(`  ${C.green}✅ PASS${C.reset}  ${msg}`);
}
function logFail(msg) {
  console.log(`  ${C.red}❌ FAIL${C.reset}  ${msg}`);
}
function logInfo(msg) {
  console.log(`  ${C.cyan}ℹ️  INFO${C.reset}  ${msg}`);
}
function section(title) {
  console.log(`\n${C.bold}${C.yellow}━━━ ${title} ━━━${C.reset}`);
}
function subsection(title) {
  console.log(`\n${C.dim}  · ${title}${C.reset}`);
}

// ============ 有效身份证号（符合校验位规则）============
// 每次运行使用基于时间戳的唯一手机号/身份证号/银行卡号，避免历史数据冲突
const VALID_NAME = '张三';

// 基于时间戳生成唯一后缀（4位数字），保证脚本可重复执行
const RUN_SUFFIX = String(Date.now()).slice(-4);

// 校验位合法的身份证号生成器（基于固定前缀 + 动态后缀，计算正确校验位）
function genIdCard(suffix3) {
  const prefix = '11010119900307'; // 前14位固定
  const body17 = prefix + suffix3; // 17位
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(body17[i], 10) * weights[i];
  return body17 + checkCodes[sum % 11];
}

const PHONES = {
  B: `138${RUN_SUFFIX}1111`,
  C: `138${RUN_SUFFIX}2222`,
  D: `138${RUN_SUFFIX}3333`,
};

const ID_CARDS = {
  B: genIdCard(RUN_SUFFIX[0] + RUN_SUFFIX[1] + RUN_SUFFIX[2]),
  C: genIdCard(RUN_SUFFIX[0] + RUN_SUFFIX[1] + String(parseInt(RUN_SUFFIX[2]) + 1)),
  D: genIdCard(RUN_SUFFIX[0] + RUN_SUFFIX[1] + String(parseInt(RUN_SUFFIX[2]) + 2)),
};

const BANK_CARDS = {
  D: `6222021234${RUN_SUFFIX}5678`, // 19位
};

// ============ 用户定义 ============
const USER_DEFS = [
  { key: 'A', nickname: '测试用户A-完全未认证', phone: false, realName: false, bankCard: false },
  { key: 'B', nickname: '测试用户B-仅手机号',   phone: true,  realName: false, bankCard: false },
  { key: 'C', nickname: '测试用户C-缺银行卡',   phone: true,  realName: true,  bankCard: false },
  { key: 'D', nickname: '测试用户D-全部认证',   phone: true,  realName: true,  bankCard: true  },
];

// ============ 用例统计 ============
const stats = { total: 0, pass: 0, fail: 0 };
function assert(name, actual, expected, note = '') {
  stats.total++;
  const ok = actual === expected;
  if (ok) {
    stats.pass++;
    logPass(`${name}: 实际=${actual} 预期=${expected}${note ? ` (${note})` : ''}`);
  } else {
    stats.fail++;
    logFail(`${name}: 实际=${actual} 预期=${expected}${note ? ` (${note})` : ''}`);
  }
  return ok;
}

// ============ 主流程 ============
async function main() {
  console.log(C.bold + '\n╔══════════════════════════════════════════════════════════════╗' + C.reset);
  console.log(C.bold + '║          认证门控逻辑端到端测试 (Verification Gating)        ║' + C.reset);
  console.log(C.bold + '╚══════════════════════════════════════════════════════════════╝' + C.reset);
  console.log(`后端地址: ${BASE_URL}`);
  console.log(`开始时间: ${new Date().toLocaleString('zh-CN')}`);

  // 0. 探测后端健康
  section('0. 后端健康检查');
  try {
    const r = await request('GET', '/auth/me', null, {});
    if (r.statusCode === 401) {
      logPass('后端在线（未登录返回 401，符合预期）');
    } else {
      logInfo(`后端返回状态码 ${r.statusCode}，继续...`);
    }
  } catch (e) {
    console.error(`\n${C.red}无法连接到后端服务！请确认已执行：${C.reset}`);
    console.error(`  1. docker compose up -d mysql redis`);
    console.error(`  2. cd bff && npm run start:dev`);
    console.error(`错误: ${e.message}`);
    process.exit(1);
  }

  // 1. 创建 4 个用户
  section('1. 创建测试用户并按定义完成认证绑定');
  const users = {}; // key -> { id, token, definition }

  for (const def of USER_DEFS) {
    subsection(`用户 ${def.key}: ${def.nickname}`);

    // 1a. test-login 创建用户
    const loginR = await request('POST', '/auth/test-login', { nickname: def.nickname });
    if (loginR.data.code !== 0) {
      logFail(`创建用户失败: ${JSON.stringify(loginR.data)}`);
      continue;
    }
    const { accessToken, user } = loginR.data.data;
    users[def.key] = { id: user.id, token: accessToken, def };
    logInfo(`userId=${user.id}, role=${user.role}`);

    const header = authHeader(accessToken);

    // 1b. 绑定手机号
    if (def.phone) {
      const phone = PHONES[def.key];
      const r = await request('POST', '/verification/phone', { phone }, header);
      assert(
        `用户${def.key} 绑定手机号`,
        r.data.code === 0 ? 'success' : `fail(${r.data.code}:${r.data.message})`,
        'success',
      );
    }

    // 1c. 提交实名认证
    if (def.realName) {
      const idCard = ID_CARDS[def.key];
      const r = await request(
        'POST',
        '/verification/real-name',
        { realName: VALID_NAME, idCardNumber: idCard },
        header,
      );
      assert(
        `用户${def.key} 实名认证`,
        r.data.code === 0 ? 'success' : `fail(${r.data.code}:${r.data.message})`,
        'success',
      );
    }

    // 1d. 绑定银行卡（需先实名）
    if (def.bankCard) {
      const cardNo = BANK_CARDS[def.key];
      const r = await request(
        'POST',
        '/verification/bank-card',
        {
          holderName: VALID_NAME,
          bankName: '中国工商银行',
          cardNumber: cardNo,
          isDefault: true,
        },
        header,
      );
      assert(
        `用户${def.key} 绑定银行卡`,
        r.data.code === 0 ? 'success' : `fail(${r.data.code}:${r.data.message})`,
        'success',
      );
    }
  }

  // 2. 验证认证状态查询接口
  section('2. 认证状态查询验证 (GET /verification/status)');
  for (const def of USER_DEFS) {
    const u = users[def.key];
    if (!u) continue;
    subsection(`用户 ${def.key}`);
    const r = await request('GET', '/verification/status', null, authHeader(u.token));
    if (r.data.code !== 0) {
      logFail(`获取认证状态失败: ${JSON.stringify(r.data)}`);
      continue;
    }
    const s = r.data.data;
    assert(`用户${def.key} phoneBound`, String(s.phoneBound), String(def.phone));
    assert(`用户${def.key} realNameVerified`, String(s.realNameVerified), String(def.realName));
    assert(`用户${def.key} bankCardBound`, String(s.bankCardBound), String(def.bankCard));
    const expectedCanUse = def.phone && def.realName && def.bankCard;
    assert(`用户${def.key} canUseCoreFeatures`, String(s.canUseCoreFeatures), String(expectedCanUse));
    assert(`用户${def.key} canWithdraw`, String(s.canWithdraw), String(expectedCanUse));
  }

  // 3. 先用用户 D 创建一个任务，供接单测试使用
  section('3. 准备测试环境：由已认证用户 D 发布一个任务（供 A/B/C 尝试接单）');
  let sharedTaskId = null;
  {
    const u = users['D'];
    const header = authHeader(u.token);

    // 先查任务类别 ID
    const catR = await request('GET', '/tasks/nearby?page=1');
    // 由于可能没有类别，从 seed 中第一个类别通常 id=1；直接尝试用 categoryId="1"
    const publishR = await request(
      'POST',
      '/tasks',
      {
        title: '认证门控测试-临时任务',
        categoryId: '10',
        description: '这是用于测试认证门控的临时任务，描述至少10个字以上',
        price: 5.0,
        lat: 31.2304,
        lng: 121.4737,
        address: '上海市黄浦区人民广场',
        urgency: 'NORMAL',
      },
      header,
    );
    if (publishR.data.code === 0) {
      sharedTaskId = publishR.data.data.id;
      logPass(`用户 D 发布任务成功，taskId=${sharedTaskId}（用于接单测试）`);
    } else {
      logFail(
        `用户 D 发布任务失败: code=${publishR.data.code}, msg=${publishR.data.message}。` +
          `请确认 task_categories 表已 seed（npm run prisma:seed）`,
      );
    }
  }

  // 4. 发布任务门控测试
  section('4. 门控测试：发布任务 (POST /tasks)');
  for (const def of USER_DEFS) {
    const u = users[def.key];
    if (!u) continue;
    subsection(`用户 ${def.key} (${def.nickname})`);
    const r = await request(
      'POST',
      '/tasks',
      {
        title: `门控测试-${def.key}-发布`,
        categoryId: '10',
        description: '认证门控发布任务测试，描述长度需要满足至少10个字',
        price: 3.0,
        lat: 31.23,
        lng: 121.47,
        address: '测试地址-XX路XX号',
      },
      authHeader(u.token),
    );
    const shouldBlock = !(def.phone && def.realName && def.bankCard);
    const actualBlocked = r.data.code === 403 || r.statusCode === 403;

    if (shouldBlock) {
      const ok = assert(
        `用户${def.key} 发布任务应被拦截`,
        actualBlocked ? 'blocked(403)' : `passed(code=${r.data.code})`,
        'blocked(403)',
        `msg="${r.data.message || '(空)'}"`,
      );
      if (ok && r.data.message) {
        logInfo(`拦截提示：${r.data.message}`);
      }
    } else {
      assert(
        `用户${def.key} 发布任务应放行`,
        r.data.code === 0 ? 'pass(code=0)' : `blocked(code=${r.data.code},msg=${r.data.message})`,
        'pass(code=0)',
      );
      // 清理：成功发布的话，若 taskId 已记录则无妨，后面不再使用
    }
  }

  // 5. 接单门控测试
  section('5. 门控测试：报价接单 (POST /tasks/:id/accept)');
  if (!sharedTaskId) {
    logInfo('跳过：共享任务未创建成功（需先通过用户 D 发布任务）');
  } else {
    for (const def of USER_DEFS) {
      const u = users[def.key];
      if (!u) continue;
      subsection(`用户 ${def.key}`);
      const r = await request(
        'POST',
        `/tasks/${sharedTaskId}/accept`,
        {},
        authHeader(u.token),
      );
      const shouldBlock = !(def.phone && def.realName && def.bankCard);
      const actualBlocked = r.data.code === 403 || r.statusCode === 403;

      if (shouldBlock) {
        assert(
          `用户${def.key} 接单应被拦截`,
          actualBlocked ? 'blocked(403)' : `passed(code=${r.data.code})`,
          'blocked(403)',
          `msg="${r.data.message || '(空)'}"`,
        );
      } else {
        // 用户 D 自己不能接自己发布的任务，会返回 403"不能接自己的任务"
        // 关键区分：认证门控 403 的 message 包含"请先完成认证"，业务 403 不包含
        const isGatingBlock =
          (r.data.code === 403 || r.statusCode === 403) &&
          (r.data.message || '').includes('请先完成认证');
        assert(
          `用户${def.key} 接单不应被认证门控拦截`,
          !isGatingBlock ? 'not_gated(正常业务处理)' : `gated(403:${r.data.message})`,
          'not_gated(正常业务处理)',
          `实际 code=${r.data.code}, msg="${r.data.message || ''}"`,
        );
      }
    }
  }

  // 6. 提现门控测试
  section('6. 门控测试：钱包提现 (POST /wallet/withdraw)');
  for (const def of USER_DEFS) {
    const u = users[def.key];
    if (!u) continue;
    subsection(`用户 ${def.key}`);
    const r = await request(
      'POST',
      '/wallet/withdraw',
      { amount: 10 }, // 10 元，低于 1000 元走自动流程
      authHeader(u.token),
    );
    const shouldBlock = !(def.phone && def.realName && def.bankCard);
    const actualBlocked = r.data.code === 403 || r.statusCode === 403;

    if (shouldBlock) {
      assert(
        `用户${def.key} 提现将被认证门控拦截`,
        actualBlocked ? 'blocked(403)' : `passed(code=${r.data.code})`,
        'blocked(403)',
        `msg="${r.data.message || '(空)'}"`,
      );
    } else {
      // 放行后可能因余额不足 / 缺少 openid 等业务错误，只要不是 403 门控即视为通过
      const notGatingBlock = r.data.code !== 403 && r.statusCode !== 403;
      assert(
        `用户${def.key} 提现不应被认证门控拦截`,
        notGatingBlock
          ? `not_gated(code=${r.data.code})`
          : `gated(403:${r.data.message})`,
        `not_gated(code=${r.data.code})`,
        `业务响应 msg="${r.data.message || ''}"`,
      );
    }
  }

  // 7. 打印报告
  section('7. 测试报告汇总');
  console.log(`\n  ${C.bold}总用例数:${C.reset} ${stats.total}`);
  console.log(`  ${C.green}通过数:${C.reset}    ${stats.pass}`);
  console.log(`  ${C.red}失败数:${C.reset}    ${stats.fail}`);
  const rate = stats.total === 0 ? 0 : ((stats.pass / stats.total) * 100).toFixed(1);
  console.log(`  通过率:    ${rate}%`);

  if (stats.fail === 0) {
    console.log(`\n${C.green}${C.bold}🎉 全部用例通过！认证门控逻辑工作正常。${C.reset}`);
  } else {
    console.log(`\n${C.red}${C.bold}⚠️  有 ${stats.fail} 个用例失败，请检查上方日志。${C.reset}`);
    console.log(`${C.dim}提示：`);
    console.log(`  - 若用户 D 发布任务失败，可能是 task_categories 表未 seed，执行：`);
    console.log(`    cd bff && npx prisma db seed`);
    console.log(`  - 若所有请求都 500，请检查 Redis / MySQL 是否正常启动：`);
    console.log(`    docker compose up -d mysql redis${C.reset}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n${C.red}测试脚本异常终止: ${e.message}${C.reset}`);
  console.error(e.stack);
  process.exit(2);
});
