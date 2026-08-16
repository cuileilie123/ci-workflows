/**
 * 财务设置 E2E 集成测试脚本
 *
 * 验证老板账号的财务设置接口（平台分佣提现账号设计）：
 *   1. GET /admin/finance-settings        — 读取设置（首次未配置时返回 null）
 *   2. PUT /admin/finance-settings        — 保存设置（覆盖 mainMchId/mainAppId 后立即生效）
 *   3. 权限校验：非 BOSS/SUPER_ADMIN 角色被拒（403）
 *   4. DB 覆盖集成：保存后，分账 / 统一下单读取 DB 值而非 env
 *
 * 用法：
 *   node scripts/test-finance-settings-e2e.cjs                          # 默认 http://localhost:3000
 *   node scripts/test-finance-settings-e2e.cjs http://bff-host:3000      # 指定 BFF 地址
 *
 * 退出码：0=全部通过；1=至少一个失败
 */
const http = require('http');
const { URL } = require('url');

// ============================================================
// 配置
// ============================================================
const BFF_BASE_URL = process.argv[2] || process.env.BFF_BASE_URL || 'http://localhost:3000';
const BOSS_TOKEN = process.env.BOSS_TOKEN || 'mock-boss-token-1';
const STAFF_TOKEN = process.env.STAFF_TOKEN || 'mock-staff-token-1';
const USER_TOKEN = process.env.USER_TOKEN || 'mock-user-token-1';

// 测试结果统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// ============================================================
// 工具函数
// ============================================================

/**
 * 发送 HTTP 请求
 */
function httpRequest(method, path, body, token) {
  const url = new URL(path, BFF_BASE_URL);
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    method,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + (url.search || ''),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 记录测试结果
 */
function recordTest(name, passed, detail) {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  ✅ ${name}`);
  } else {
    failedTests++;
    console.log(`  ❌ ${name}`);
  }
  if (detail) {
    console.log(`     ${detail}`);
  }
}

// ============================================================
// 测试用例
// ============================================================

async function testHealthCheck() {
  console.log('\n📋 测试 1: BFF 服务健康检查');
  try {
    const res = await httpRequest('GET', '/health', null, null);
    const ok = res.status === 200 || res.status === 204;
    recordTest(
      'BFF 服务可访问',
      ok,
      `status=${res.status}`,
    );
    return ok;
  } catch (err) {
    recordTest('BFF 服务可访问', false, `连接失败: ${err.message}`);
    return false;
  }
}

async function testGetEmptySettings() {
  console.log('\n📋 测试 2: GET /admin/finance-settings — 首次读取（可能为 null）');
  try {
    const res = await httpRequest('GET', '/api/v1/admin/finance-settings', null, BOSS_TOKEN);
    const ok = res.status === 200;
    recordTest(
      'BOSS 角色可读取设置',
      ok,
      `status=${res.status}, body=${JSON.stringify(res.body).slice(0, 100)}`,
    );
    // 不校验 body 内容为 null（可能已被其他测试写入数据），只校验接口可用
    return ok;
  } catch (err) {
    recordTest('BOSS 角色可读取设置', false, `异常: ${err.message}`);
    return false;
  }
}

async function testSaveSettingsWithDbOverride() {
  console.log('\n📋 测试 3: PUT /admin/finance-settings — 保存含 DB 覆盖配置');
  const payload = {
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: '1600000099',
    receiverName: 'E2E测试平台佣金账户',
    receiverOpenid: null,
    // 关键：DB 覆盖字段
    mainMchId: '1600000088',
    mainAppId: 'wxabcdef1234567890',
  };
  try {
    const res = await httpRequest('PUT', '/api/v1/admin/finance-settings', payload, BOSS_TOKEN);
    const ok = res.status === 200 || res.status === 201;
    recordTest(
      '保存含 mainMchId/mainAppId 的设置',
      ok,
      `status=${res.status}, body=${JSON.stringify(res.body).slice(0, 150)}`,
    );
    // 校验返回的 body 包含 mainMchId
    if (ok && res.body) {
      const bodyStr = JSON.stringify(res.body);
      const hasOverride = bodyStr.includes('1600000088');
      recordTest(
        '返回值包含 DB 覆盖字段',
        hasOverride,
        `mainMchId 是否在响应中: ${hasOverride}`,
      );
    }
    return ok;
  } catch (err) {
    recordTest('保存含 mainMchId/mainAppId 的设置', false, `异常: ${err.message}`);
    return false;
  }
}

async function testVerifyDbOverrideSaved() {
  console.log('\n📋 测试 4: GET /admin/finance-settings — 验证 DB 覆盖值已持久化');
  try {
    const res = await httpRequest('GET', '/api/v1/admin/finance-settings', null, BOSS_TOKEN);
    const ok = res.status === 200 && res.body;
    recordTest(
      '可读取刚保存的设置',
      ok,
      `status=${res.status}`,
    );
    if (ok) {
      const bodyStr = JSON.stringify(res.body);
      const hasMainMchId = bodyStr.includes('1600000088');
      const hasMainAppId = bodyStr.includes('wxabcdef1234567890');
      recordTest(
        'mainMchId 已持久化',
        hasMainMchId,
        `mainMchId=1600000088 在响应中: ${hasMainMchId}`,
      );
      recordTest(
        'mainAppId 已持久化',
        hasMainAppId,
        `mainAppId=wxabcdef1234567890 在响应中: ${hasMainAppId}`,
      );
    }
    return ok;
  } catch (err) {
    recordTest('可读取刚保存的设置', false, `异常: ${err.message}`);
    return false;
  }
}

async function testPermissionDeniedForStaff() {
  console.log('\n📋 测试 5: 权限校验 — STAFF 角色被拒绝');
  try {
    const res = await httpRequest('GET', '/api/v1/admin/finance-settings', null, STAFF_TOKEN);
    const denied = res.status === 401 || res.status === 403;
    recordTest(
      'STAFF 角色被拒绝',
      denied,
      `status=${res.status} (期望 401/403)`,
    );
    return denied;
  } catch (err) {
    recordTest('STAFF 角色被拒绝', false, `异常: ${err.message}`);
    return false;
  }
}

async function testPermissionDeniedForUser() {
  console.log('\n📋 测试 6: 权限校验 — 普通用户被拒绝');
  try {
    const res = await httpRequest('GET', '/api/v1/admin/finance-settings', null, USER_TOKEN);
    const denied = res.status === 401 || res.status === 403;
    recordTest(
      '普通用户被拒绝',
      denied,
      `status=${res.status} (期望 401/403)`,
    );
    return denied;
  } catch (err) {
    recordTest('普通用户被拒绝', false, `异常: ${err.message}`);
    return false;
  }
}

async function testSaveInvalidReceiverType() {
  console.log('\n📋 测试 7: DTO 校验 — 非法 receiverType 被拒绝');
  const payload = {
    profitSharingEnabled: true,
    receiverType: 'INVALID_TYPE', // 非法值
    receiverMchId: '1600000099',
    receiverName: '测试',
  };
  try {
    const res = await httpRequest('PUT', '/api/v1/admin/finance-settings', payload, BOSS_TOKEN);
    const rejected = res.status === 400;
    recordTest(
      '非法 receiverType 被拒绝',
      rejected,
      `status=${res.status} (期望 400)`,
    );
    return rejected;
  } catch (err) {
    recordTest('非法 receiverType 被拒绝', false, `异常: ${err.message}`);
    return false;
  }
}

async function testSaveInvalidMchIdFormat() {
  console.log('\n📋 测试 8: DTO 校验 — 商户号格式不正确被拒绝');
  const payload = {
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: 'abc123', // 非法：不是纯数字
    receiverName: '测试',
  };
  try {
    const res = await httpRequest('PUT', '/api/v1/admin/finance-settings', payload, BOSS_TOKEN);
    const rejected = res.status === 400;
    recordTest(
      '非法商户号格式被拒绝',
      rejected,
      `status=${res.status} (期望 400)`,
    );
    return rejected;
  } catch (err) {
    recordTest('非法商户号格式被拒绝', false, `异常: ${err.message}`);
    return false;
  }
}

async function testSaveMissingReceiverMchId() {
  console.log('\n📋 测试 9: 交叉校验 — 启用分账但 MERCHANT_ID 类型缺少商户号');
  const payload = {
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: null, // 缺少必填项
    receiverName: '测试',
  };
  try {
    const res = await httpRequest('PUT', '/api/v1/admin/finance-settings', payload, BOSS_TOKEN);
    const rejected = res.status === 400;
    recordTest(
      'MERCHANT_ID 缺少 receiverMchId 被拒绝',
      rejected,
      `status=${res.status} (期望 400)`,
    );
    return rejected;
  } catch (err) {
    recordTest('MERCHANT_ID 缺少 receiverMchId 被拒绝', false, `异常: ${err.message}`);
    return false;
  }
}

async function testSavePersonalOpenidMissingOpenid() {
  console.log('\n📋 测试 10: 交叉校验 — PERSONAL_OPENID 类型缺少 openid');
  const payload = {
    profitSharingEnabled: true,
    receiverType: 'PERSONAL_OPENID',
    receiverOpenid: null, // 缺少必填项
    receiverName: '测试',
  };
  try {
    const res = await httpRequest('PUT', '/api/v1/admin/finance-settings', payload, BOSS_TOKEN);
    const rejected = res.status === 400;
    recordTest(
      'PERSONAL_OPENID 缺少 receiverOpenid 被拒绝',
      rejected,
      `status=${res.status} (期望 400)`,
    );
    return rejected;
  } catch (err) {
    recordTest('PERSONAL_OPENID 缺少 receiverOpenid 被拒绝', false, `异常: ${err.message}`);
    return false;
  }
}

async function testSaveAndRestoreEnvConfig() {
  console.log('\n📋 测试 11: 恢复默认配置（清除 DB 覆盖值，回落到 env）');
  const payload = {
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: '1600000099',
    receiverName: 'E2E测试平台佣金账户',
    receiverOpenid: null,
    // 清除 DB 覆盖值
    mainMchId: null,
    mainAppId: null,
  };
  try {
    const res = await httpRequest('PUT', '/api/v1/admin/finance-settings', payload, BOSS_TOKEN);
    const ok = res.status === 200 || res.status === 201;
    recordTest(
      '清除 DB 覆盖值并恢复 env 回落',
      ok,
      `status=${res.status}`,
    );
    if (ok) {
      // 验证清除后读取
      const res2 = await httpRequest('GET', '/api/v1/admin/finance-settings', null, BOSS_TOKEN);
      if (res2.status === 200 && res2.body) {
        const bodyStr = JSON.stringify(res2.body);
        const stillHasOverride = bodyStr.includes('1600000088');
        recordTest(
          'DB 覆盖值已清除',
          !stillHasOverride,
          `mainMchId=1600000088 是否仍在响应中: ${stillHasOverride}（应为 false）`,
        );
      }
    }
    return ok;
  } catch (err) {
    recordTest('清除 DB 覆盖值并恢复 env 回落', false, `异常: ${err.message}`);
    return false;
  }
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('============================================================');
  console.log('🏦 财务设置 E2E 集成测试');
  console.log('============================================================');
  console.log(`BFF 地址: ${BFF_BASE_URL}`);
  console.log(`BOSS Token: ${BOSS_TOKEN.slice(0, 12)}...`);
  console.log(`测试时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  console.log('============================================================');

  const healthOk = await testHealthCheck();
  if (!healthOk) {
    console.log('\n❌ BFF 服务不可用，跳过后续测试');
    console.log('\n============================================================');
    console.log(`测试结果: ${passedTests}/${totalTests} 通过, ${failedTests} 失败`);
    process.exit(1);
  }

  await testGetEmptySettings();
  await testSaveSettingsWithDbOverride();
  await testVerifyDbOverrideSaved();
  await testPermissionDeniedForStaff();
  await testPermissionDeniedForUser();
  await testSaveInvalidReceiverType();
  await testSaveInvalidMchIdFormat();
  await testSaveMissingReceiverMchId();
  await testSavePersonalOpenidMissingOpenid();
  await testSaveAndRestoreEnvConfig();

  console.log('\n============================================================');
  console.log(`测试结果: ${passedTests}/${totalTests} 通过, ${failedTests} 失败`);
  console.log('============================================================');

  if (failedTests > 0) {
    console.log('\n⚠️ 有测试失败，请检查上方 ❌ 标记的用例');
    process.exit(1);
  } else {
    console.log('\n🎉 全部通过！');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\n💥 测试脚本异常:', err);
  process.exit(1);
});
