const http = require('http');

const BASE_URL = 'http://localhost:3000/api/v1';

function request(method, path, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
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
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function testMockLogin() {
  console.log('=== 测试 Mock 登录 ===\n');

  // 1. Mock 登录
  console.log('1. 调用 /api/v1/auth/test-login...');
  const loginRes = await request('POST', '/api/v1/auth/test-login', {
    nickname: '测试Mock用户',
  });
  console.log('登录响应:', JSON.stringify(loginRes, null, 2));

  if (loginRes.code !== 0 || !loginRes.data?.accessToken) {
    console.error('❌ 登录失败！');
    return;
  }

  const { accessToken, refreshToken, user } = loginRes.data;
  console.log('\n✅ 登录成功！');
  console.log('用户 ID:', user.id);
  console.log('用户昵称:', user.nickname);
  console.log('Access Token:', accessToken.slice(0, 50) + '...');
  console.log('Refresh Token:', refreshToken.slice(0, 50) + '...');

  // 2. 测试 /auth/me
  console.log('\n2. 调用 /api/v1/auth/me...');
  const meRes = await request('GET', '/api/v1/auth/me', null, {
    Authorization: `Bearer ${accessToken}`,
  });
  console.log('用户信息:', JSON.stringify(meRes, null, 2));

  // 3. 测试 token 刷新
  console.log('\n3. 调用 /api/v1/auth/refresh...');
  const refreshRes = await request('POST', '/api/v1/auth/refresh', { refreshToken });
  console.log('刷新响应:', JSON.stringify(refreshRes, null, 2));

  console.log('\n=== 测试完成 ===');
}

testMockLogin().catch((err) => {
  console.error('❌ 测试失败:', err.message);
  process.exit(1);
});
