/**
 * 诊断脚本：测试 automator 连接和基本命令
 */
const automator = require('miniprogram-automator');

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时: ${label}`)), ms)),
  ]);
}

async function diag() {
  console.log('1. 尝试 connect...');
  let mp;
  try {
    mp = await withTimeout(automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }), 10000, 'connect');
    console.log('   ✓ connect 成功');
  } catch (e) {
    console.log('   ✗ connect 失败: ' + e.message);
    return;
  }

  // 测试 systemInfo
  console.log('2. 测试 systemInfo...');
  try {
    const info = await withTimeout(mp.systemInfo, 8000, 'systemInfo');
    console.log('   ✓ systemInfo:', JSON.stringify(info));
  } catch (e) {
    console.log('   ✗ systemInfo 失败: ' + e.message);
  }

  // 测试简单 evaluate
  console.log('3. 测试 evaluate(简单)...');
  try {
    const r = await withTimeout(mp.evaluate(() => 1 + 1), 8000, 'evaluate');
    console.log('   ✓ evaluate 结果:', r);
  } catch (e) {
    console.log('   ✗ evaluate 失败: ' + e.message);
  }

  // 测试 evaluate(wx API)
  console.log('4. 测试 evaluate(wx.getStorageSync)...');
  try {
    const r = await withTimeout(mp.evaluate(() => {
      return wx.getStorageSync('nh_access_token') || '(empty)';
    }), 8000, 'evaluate wx');
    console.log('   ✓ evaluate wx 结果:', r);
  } catch (e) {
    console.log('   ✗ evaluate wx 失败: ' + e.message);
  }

  // 测试 reLaunch
  console.log('5. 测试 reLaunch(/pages/index/index)...');
  try {
    const page = await withTimeout(mp.reLaunch('/pages/index/index'), 10000, 'reLaunch');
    console.log('   ✓ reLaunch 成功, page:', page);
  } catch (e) {
    console.log('   ✗ reLaunch 失败: ' + e.message);
  }

  // 测试 pageStack
  console.log('6. 测试 pageStack...');
  try {
    const stack = await withTimeout(mp.pageStack, 8000, 'pageStack');
    console.log('   ✓ pageStack 长度:', stack.length);
    if (stack.length > 0) {
      console.log('   当前页 path:', stack[stack.length - 1].path);
    }
  } catch (e) {
    console.log('   ✗ pageStack 失败: ' + e.message);
  }

  // 测试 page.data
  console.log('7. 测试 page.data...');
  try {
    const stack = await withTimeout(mp.pageStack, 5000, 'pageStack2');
    if (stack.length > 0) {
      const page = stack[stack.length - 1];
      const data = await withTimeout(page.data, 5000, 'page.data');
      console.log('   ✓ page.data:', JSON.stringify(data).substring(0, 300));
    }
  } catch (e) {
    console.log('   ✗ page.data 失败: ' + e.message);
  }

  console.log('\n诊断完成');
  await mp.close().catch(() => {});
}

diag().catch((e) => console.error('致命错误:', e));
