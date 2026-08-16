// 临时调试：测试同一个 BOSS 登录 token，立即调用 /api/v1/auth/me 和 /api/v1/admin/finance-settings
const http = require('http');
const { URL } = require('url');

const BFF_BASE_URL = 'http://localhost:3000';
function request(method, path, body, token) {
  const url = new URL(path, BFF_BASE_URL);
  const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
  const opts = {
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
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  // 1. test-login 老板
  const login = await request('POST', '/api/v1/auth/test-login', { userId: '1' });
  console.log('1) login status:', login.status);
  const token = login.body?.data?.accessToken;
  console.log('   token (first 30):', token ? token.slice(0, 30) : 'NULL');

  if (!token) { console.error('登录失败'); process.exit(1); }

  // 2. 立即调 /auth/me
  const me = await request('GET', '/api/v1/auth/me', null, token);
  console.log('\n2) /auth/me status:', me.status, 'body:', JSON.stringify(me.body).slice(0, 300));

  // 3. 立即调 /admin/finance-settings
  const fin = await request('GET', '/api/v1/admin/finance-settings', null, token);
  console.log('\n3) /admin/finance-settings status:', fin.status, 'body:', JSON.stringify(fin.body).slice(0, 300));

  // 4. 解析 token，查看 iat/exp 时间是否合理
  if (token) {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      console.log('\n4) token payload:', JSON.stringify(payload, null, 2));
      const now = Math.floor(Date.now() / 1000);
      console.log('   now:', now, 'iat diff(s):', now - (payload.iat ?? 0), 'exp left(s):', (payload.exp ?? 0) - now);
    }
  }
})();
