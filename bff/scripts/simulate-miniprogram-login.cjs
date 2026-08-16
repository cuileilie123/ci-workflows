const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/api/v1';
const TOKEN_FILE = path.join(__dirname, '.mock-tokens.json');

function request(method, urlPath, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
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
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
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

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log('💾 Token 已保存到:', TOKEN_FILE);
}

function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  }
  return null;
}

async function simulateMiniProgramLogin() {
  console.log('🔐 模拟微信小程序登录流程\n');
  console.log('=' .repeat(50));

  // 步骤 1: 模拟 wx.login() 获取 code
  console.log('\n📱 步骤 1: 模拟微信 wx.login() 获取 code...');
  const mockCode = `mock_code_${Date.now()}`;
  console.log('   获取到 mock code:', mockCode);

  // 步骤 2: 调用后端 test-login 接口
  console.log('\n📡 步骤 2: 调用 POST /api/v1/auth/test-login...');
  const loginRes = await request('POST', '/api/v1/auth/test-login', {
    nickname: '小程序测试用户',
  });

  if (loginRes.data.code !== 0) {
    console.error('❌ 登录失败！响应:', JSON.stringify(loginRes.data, null, 2));
    return;
  }

  const { accessToken, refreshToken, user } = loginRes.data.data;
  console.log('✅ 登录成功！');
  console.log('   用户 ID:', user.id);
  console.log('   昵称:', user.nickname);
  console.log('   信用分:', user.creditScore);

  // 保存 token（模拟 uni.setStorageSync）
  saveTokens({ accessToken, refreshToken, user });

  // 步骤 3: 使用 token 访问受保护接口 /auth/me
  console.log('\n📡 步骤 3: 调用 GET /api/v1/auth/me (携带 Bearer Token)...');
  const meRes = await request('GET', '/api/v1/auth/me', null, {
    Authorization: `Bearer ${accessToken}`,
  });

  if (meRes.data.code === 0) {
    console.log('✅ 用户信息获取成功！');
    console.log('   用户数据:', JSON.stringify(meRes.data.data, null, 2));
  } else if (meRes.data.code === 401) {
    console.log('⚠️  Token 过期，尝试刷新...');

    // 步骤 4: Token 刷新
    console.log('\n📡 步骤 4: 调用 POST /api/v1/auth/refresh...');
    const refreshRes = await request('POST', '/api/v1/auth/refresh', {
      refreshToken,
    });

    if (refreshRes.data.code === 0) {
      const { accessToken: newToken, refreshToken: newRefresh } = refreshRes.data.data;
      console.log('✅ Token 刷新成功！');
      saveTokens({ accessToken: newToken, refreshToken: newRefresh, user });

      // 用新 token 重试
      console.log('\n📡 步骤 5: 用新 Token 重试 /api/v1/auth/me...');
      const retryRes = await request('GET', '/api/v1/auth/me', null, {
        Authorization: `Bearer ${newToken}`,
      });
      console.log('✅ 用户信息获取成功！', JSON.stringify(retryRes.data.data, null, 2));
    } else {
      console.error('❌ Token 刷新失败:', refreshRes.data.message);
    }
  }

  // 步骤 6: 测试访问个人中心相关接口
  console.log('\n📡 步骤 6: 测试钱包接口 GET /api/v1/wallet...');
  const walletRes = await request('GET', '/api/v1/wallet', null, {
    Authorization: `Bearer ${accessToken}`,
  });
  console.log('钱包数据:', JSON.stringify(walletRes.data, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log('🎉 所有接口测试完成！');
  console.log('\n💡 提示：如果真机调试仍失败，请检查：');
  console.log('   1. 手机和电脑是否在同一 WiFi 网络？');
  console.log('   2. Windows 防火墙是否允许 Node.js 访问？');
  console.log('   3. 前端环境变量是否使用了局域网 IP (192.168.10.29)？');
  console.log('   4. 微信开发者工具是否使用"真机调试"模式（不是"预览"）？');
}

simulateMiniProgramLogin().catch((err) => {
  console.error('❌ 测试失败:', err.message);
  console.error('\n请确认后端服务已启动：');
  console.error('   cd bff && npm run start:dev');
  process.exit(1);
});
