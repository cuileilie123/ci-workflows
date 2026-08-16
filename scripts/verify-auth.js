#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * JWT 权限验证脚本：验证 BFF 受保护接口的鉴权链路是否生效。
 *
 * 测试矩阵：
 *   1. 无 Token 访问受保护接口    → 期望 401
 *   2. 有效 Token 访问受保护接口  → 期望 200
 *   3. 无效 Token 访问受保护接口  → 期望 401
 *   4. 有效 Token 访问钱包接口    → 期望 200
 *   5. 篡改 Token 访问应返回 401
 *   6. 登出后旧 Token 访问应返回 401（黑名单生效）
 *
 * 用法：
 *   node scripts/verify-auth.js
 *   node scripts/verify-auth.js --base-url http://localhost:3000
 *   node scripts/verify-auth.js --nickname "测试用户"
 */

const http = require('http');
const https = require('https');

// ---------- HTTP 工具 ----------

function httpRequest(method, url, body, token, timeout = 10000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsedBody;
          try {
            parsedBody = raw ? JSON.parse(raw) : {};
          } catch {
            parsedBody = { _raw: raw };
          }
          resolve({ status: res.statusCode, body: parsedBody });
        });
      },
    );

    req.on('error', (err) => {
      resolve({ status: -1, body: { error: err.message } });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: -1, body: { error: 'timeout' } });
    });
    if (data) req.write(data);
    req.end();
  });
}

function truncate(s, maxLen = 80) {
  s = String(s);
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '...';
}

// ---------- 测试框架 ----------

class TestResult {
  constructor(name) {
    this.name = name;
    this.passed = false;
    this.expected = '';
    this.actual = '';
    this.detail = '';
  }
  toString() {
    const mark = this.passed ? '[PASS]' : '[FAIL]';
    return (
      `  ${mark} ${this.name}\n` +
      `         expect: ${this.expected}\n` +
      `         actual: ${this.actual}\n` +
      `         detail: ${truncate(this.detail)}`
    );
  }
}

/**
 * 运行全部鉴权测试（核心逻辑，支持 httpClient 依赖注入）
 * @param {Function} httpClient - (method, url, body, token) => Promise<{status, body}>
 * @param {Object} options - { baseUrl, nickname }
 * @returns {Promise<TestResult[]>} 测试结果列表
 */
async function runTests(httpClient, options = {}) {
  const {
    baseUrl = 'http://localhost:3000',
    nickname = '权限测试用户',
  } = options;

  const api = baseUrl.replace(/\/$/, '') + '/api/v1';
  const results = [];

  // ---- 步骤 0：获取 Token ----
  const { status: tStatus, body: tBody } = await httpClient(
    'POST',
    `${api}/auth/test-login`,
    { nickname },
  );
  if (tStatus !== 200 || tBody.code !== 0 || !tBody.data || !tBody.data.accessToken) {
    // 无法获取 Token，返回空结果（调用方处理）
    return results;
  }

  const token = tBody.data.accessToken;
  const refresh = tBody.data.refreshToken;
  const userId = tBody.data.user.id;

  // ---- 测试 1：无 Token 访问 /auth/me ----
  {
    const r = new TestResult('无 Token 访问受保护接口应返回 401');
    r.expected = 'status=401';
    const { status, body } = await httpClient('GET', `${api}/auth/me`);
    r.actual = `status=${status}`;
    r.detail = JSON.stringify(body);
    r.passed = status === 401;
    results.push(r);
  }

  // ---- 测试 2：有效 Token 访问 /auth/me ----
  {
    const r = new TestResult('有效 Token 访问 /auth/me 应返回 200 + 用户信息');
    r.expected = 'status=200, code=0, user.id 匹配';
    const { status, body } = await httpClient('GET', `${api}/auth/me`, null, token);
    r.actual = `status=${status}, code=${body.code}`;
    r.detail = JSON.stringify(body);
    r.passed =
      status === 200 &&
      body.code === 0 &&
      body.data &&
      body.data.id === userId;
    results.push(r);
  }

  // ---- 测试 3：无效 Token 访问 /auth/me ----
  {
    const r = new TestResult('无效 Token 访问受保护接口应返回 401');
    r.expected = 'status=401';
    const { status, body } = await httpClient(
      'GET',
      `${api}/auth/me`,
      null,
      'invalid.token.here',
    );
    r.actual = `status=${status}`;
    r.detail = JSON.stringify(body);
    r.passed = status === 401;
    results.push(r);
  }

  // ---- 测试 4：有效 Token 访问钱包流水 ----
  {
    const r = new TestResult('有效 Token 访问 /wallet/transactions 应返回 200');
    r.expected = 'status=200, code=0';
    const { status, body } = await httpClient(
      'GET',
      `${api}/wallet/transactions?page=1&pageSize=5`,
      null,
      token,
    );
    r.actual = `status=${status}, code=${body.code}`;
    r.detail = JSON.stringify(body);
    r.passed = status === 200 && body.code === 0;
    results.push(r);
  }

  // ---- 测试 5：篡改 Token ----
  {
    const r = new TestResult('篡改 Token 签名后访问应返回 401');
    r.expected = 'status=401';
    const tampered = token.slice(0, -5) + 'XXXXX';
    const { status, body } = await httpClient('GET', `${api}/auth/me`, null, tampered);
    r.actual = `status=${status}`;
    r.detail = JSON.stringify(body);
    r.passed = status === 401;
    results.push(r);
  }

  // ---- 步骤 6：登出 ----
  await httpClient(
    'POST',
    `${api}/auth/logout`,
    { refreshToken: refresh },
    token,
  );

  // ---- 测试 7：登出后旧 Token 访问应 401 ----
  {
    const r = new TestResult('登出后旧 Token 访问应返回 401（黑名单生效）');
    r.expected = 'status=401';
    const { status, body } = await httpClient('GET', `${api}/auth/me`, null, token);
    r.actual = `status=${status}`;
    r.detail = JSON.stringify(body);
    r.passed = status === 401;
    results.push(r);
  }

  return results;
}

// ---------- 导出（供单元测试使用） ----------

module.exports = { httpRequest, truncate, TestResult, runTests };

// ---------- CLI 入口 ----------

async function main() {
  const args = process.argv.slice(2);
  let baseUrl = 'http://localhost:3000';
  let nickname = '权限测试用户';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) baseUrl = args[++i];
    else if (args[i] === '--nickname' && args[i + 1]) nickname = args[++i];
  }

  const api = baseUrl.replace(/\/$/, '') + '/api/v1';
  console.log('=== JWT Auth Verification ===');
  console.log('Base URL :', baseUrl);
  console.log('API Root :', api);
  console.log('');

  console.log('[STEP 0] 获取测试 Token（POST /auth/test-login）');
  const results = await runTests(httpRequest, { baseUrl, nickname });

  if (results.length === 0) {
    console.log('  [ERROR] 无法获取 Token，请确认 BFF 已启动且 /auth/test-login 接口可用');
    process.exit(2);
  }

  results.forEach((r) => console.log(r.toString()));

  console.log('');
  console.log('='.repeat(60));
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`=== Summary: ${passed}/${total} passed ===`);
  console.log('='.repeat(60));

  if (passed === total) {
    console.log('[ALL PASS] JWT 权限链路完全正常！');
    process.exit(0);
  } else {
    const failed = results.filter((r) => !r.passed);
    console.log(`[FAIL] ${failed.length} 项测试未通过：`);
    failed.forEach((r) => console.log(`  - ${r.name}`));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(2);
  });
}
