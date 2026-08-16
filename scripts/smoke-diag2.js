/**
 * 诊断脚本2：绕过 currentPage()/callFunction，直接用 callWxMethod 导航
 */
const automator = require('miniprogram-automator');
const http = require('http');

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时: ${label}`)), ms)),
  ]);
}

function apiRequest(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '192.168.10.29', port: 3000,
      path: '/api/v1' + pathStr, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } catch { resolve({ status: res.statusCode, body: chunks }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function diag() {
  console.log('1. 连接...');
  const mp = await withTimeout(automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }), 10000, 'connect');
  console.log('   ✓ 连接成功');

  // 测试 callWxMethod 直接 reLaunch
  console.log('2. 直接 callWxMethod("reLaunch")...');
  try {
    const r = await withTimeout(
      mp.callWxMethod('reLaunch', { url: '/pages/index/index' }),
      15000, 'callWxMethod reLaunch'
    );
    console.log('   ✓ reLaunch 结果:', JSON.stringify(r));
  } catch (e) {
    console.log('   ✗ 失败: ' + e.message);
  }

  // 等待页面加载
  console.log('3. 等待页面加载 (3s)...');
  await new Promise(r => setTimeout(r, 3000));

  // 检查 pageStack
  console.log('4. 检查 pageStack...');
  try {
    const stack = await withTimeout(mp.pageStack, 8000, 'pageStack');
    console.log('   ✓ pageStack 长度:', stack.length);
    if (stack.length > 0) {
      console.log('   当前页:', stack[stack.length - 1].path);
    }
  } catch (e) {
    console.log('   ✗ 失败: ' + e.message);
  }

  // 测试 callWxMethod 设置 storage
  console.log('5. callWxMethod("setStorageSync")...');
  try {
    const r = await withTimeout(
      mp.callWxMethod('setStorageSync', 'nh_test_key', 'test_value'),
      8000, 'setStorageSync'
    );
    console.log('   ✓ setStorageSync 结果:', JSON.stringify(r));
  } catch (e) {
    console.log('   ✗ 失败: ' + e.message);
  }

  // 测试 callWxMethod 获取 storage
  console.log('6. callWxMethod("getStorageSync")...');
  try {
    const r = await withTimeout(
      mp.callWxMethod('getStorageSync', 'nh_test_key'),
      8000, 'getStorageSync'
    );
    console.log('   ✓ getStorageSync 结果:', JSON.stringify(r));
  } catch (e) {
    console.log('   ✗ 失败: ' + e.message);
  }

  // 测试 currentPage（之前 hang 的方法）
  console.log('7. 测试 currentPage()...');
  try {
    const page = await withTimeout(mp.currentPage(), 8000, 'currentPage');
    console.log('   ✓ currentPage:', page ? page.path : 'null');
  } catch (e) {
    console.log('   ✗ 失败: ' + e.message);
  }

  // 如果 currentPage 成功，测试 page.data
  if (true) {
    console.log('8. 获取 pageStack 中的页面数据...');
    try {
      const stack = await withTimeout(mp.pageStack, 5000, 'pageStack2');
      if (stack.length > 0) {
        const page = stack[stack.length - 1];
        console.log('   页面 path:', page.path);
        try {
          const data = await withTimeout(page.data, 8000, 'page.data');
          console.log('   ✓ page.data:', JSON.stringify(data).substring(0, 500));
        } catch (e) {
          console.log('   ✗ page.data 失败: ' + e.message);
        }
        // 测试元素查询
        try {
          const el = await withTimeout(page.$('.container'), 8000, '$container');
          console.log('   ✓ .container 元素:', el ? '找到' : '未找到');
        } catch (e) {
          console.log('   ✗ $container 失败: ' + e.message);
        }
        try {
          const btn = await withTimeout(page.$('.nearby-btn'), 5000, '$nearby-btn');
          console.log('   ✓ .nearby-btn:', btn ? '找到' : '未找到');
        } catch (e) {
          console.log('   ✗ $nearby-btn 失败: ' + e.message);
        }
      }
    } catch (e) {
      console.log('   ✗ pageStack 失败: ' + e.message);
    }
  }

  // 测试直接导航到其他页面
  console.log('9. 导航到任务列表...');
  try {
    await withTimeout(mp.callWxMethod('reLaunch', { url: '/pages/task/list' }), 10000, 'reLaunch task/list');
    await new Promise(r => setTimeout(r, 3000));
    const stack = await withTimeout(mp.pageStack, 5000, 'pageStack3');
    console.log('   ✓ 当前页:', stack.length > 0 ? stack[stack.length-1].path : 'empty');
    if (stack.length > 0) {
      const page = stack[stack.length-1];
      const data = await withTimeout(page.data, 8000, 'task list data');
      console.log('   ✓ 任务列表数据:', JSON.stringify(data).substring(0, 500));
    }
  } catch (e) {
    console.log('   ✗ 失败: ' + e.message);
  }

  console.log('\n诊断完成');
  await mp.close().catch(() => {});
}

diag().catch((e) => console.error('致命错误:', e));
