/**
 * 邻里互助小程序 - 全功能冒烟测试（微信开发者工具自动化）
 * 测试所有页面加载、API 调用、页面数据、渲染状态
 *
 * 注意：mp-weixin 的 app service 运行在 JSCore 中，没有 window/document，
 * 因此不能使用 DOM API，只能通过 page.data 和 automator 元素查询来检测。
 */
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  wsEndpoint: 'ws://127.0.0.1:9420',
  cliPath: 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  projectPath: path.join(__dirname, '..', 'frontend', 'dist', 'build', 'mp-weixin'),
  apiBaseUrl: 'http://192.168.10.29:3000/api/v1',
  apiHost: '192.168.10.29',
  apiPort: 3000,
  screenshotDir: path.join(__dirname, 'smoke-screenshots'),
};

const pageResults = [];
const bugs = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 带超时的 Promise 包装
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时(${ms}ms): ${label}`)), ms)),
  ]);
}

// 从 Node.js 调用 BFF API
function apiRequest(method, pathStr, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: CONFIG.apiHost,
        port: CONFIG.apiPort,
        path: '/api/v1' + pathStr,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(chunks) });
          } catch {
            resolve({ status: res.statusCode, body: chunks });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 测试登录（从 Node.js 直接调用 BFF）
async function doTestLogin() {
  console.log('  正在执行测试登录...');
  try {
    const res = await apiRequest('POST', '/auth/test-login', { nickname: '冒烟测试用户' });
    if (res.status === 200 && res.body && res.body.code === 0 && res.body.data) {
      console.log('  ✓ 测试登录成功, userId=' + res.body.data.user?.id);
      return { success: true, data: res.body.data };
    }
    console.log('  ✗ 测试登录失败: status=' + res.status + ', body=' + JSON.stringify(res.body).substring(0, 200));
    return { success: false, error: res.body };
  } catch (e) {
    console.log('  ✗ 测试登录异常: ' + e.message);
    return { success: false, error: e.message };
  }
}

// 通过 evaluate 设置 token 到小程序 storage
async function setTokensToStorage(mp, loginData) {
  try {
    await withTimeout(
      mp.evaluate((d) => {
        wx.setStorageSync('nh_access_token', d.accessToken);
        wx.setStorageSync('nh_refresh_token', d.refreshToken);
        return 'ok';
      }, loginData),
      10000,
      'setTokensToStorage'
    );
    return true;
  } catch (e) {
    console.log('  ✗ 设置 token 失败: ' + e.message);
    return false;
  }
}

// 测试单个页面
async function testPage(mp, name, url, options = {}) {
  console.log(`\n[测试] ${name} (${url})`);
  const result = {
    name, url, status: 'unknown',
    errors: [], pageData: null, dataKeys: [],
    elementCount: 0, bugs: [], screenshot: null,
  };

  try {
    // 导航到页面
    let page;
    try {
      page = await withTimeout(mp.reLaunch(url), 15000, `导航 ${url}`);
      await sleep(options.wait || 2500);
    } catch (navErr) {
      result.status = 'nav_failed';
      result.errors.push('导航失败: ' + navErr.message);
      bugs.push({ page: name, url, severity: 'critical', description: `页面导航失败: ${navErr.message}` });
      pageResults.push(result);
      console.log(`  ✗ 导航失败: ${navErr.message}`);
      return result;
    }

    // 获取页面栈
    let stack;
    try {
      stack = await withTimeout(mp.pageStack, 5000, 'pageStack');
    } catch (e) {
      stack = [page];
    }
    const currentPage = stack[stack.length - 1] || page;

    // 获取页面路径
    try {
      const pagePath = await withTimeout(currentPage.path, 5000, 'page.path');
      result.pagePath = pagePath;
    } catch {}

    // 获取页面数据
    try {
      const data = await withTimeout(currentPage.data, 8000, 'page.data');
      result.pageData = data;
      result.dataKeys = Object.keys(data || {});
      // 截取数据摘要
      const dataStr = JSON.stringify(data || {});
      result.dataSummary = dataStr.length > 500 ? dataStr.substring(0, 500) + '...' : dataStr;
    } catch (e) {
      result.errors.push('获取页面数据失败: ' + e.message);
      result.dataSummary = '获取失败';
    }

    // 查询页面元素（检测白屏）
    let elementCount = 0;
    try {
      // 尝试查询 view 元素
      const elements = await withTimeout(currentPage.$$('view, text, image, button'), 8000, '$$');
      elementCount = elements ? elements.length : 0;
    } catch (e) {
      // $$ 可能不支持多选择器，尝试单个
      try {
        const views = await withTimeout(currentPage.$$('view'), 5000, '$$view');
        elementCount = views ? views.length : 0;
      } catch {
        try {
          const el = await withTimeout(currentPage.$('.container'), 5000, '$container');
          elementCount = el ? 1 : 0;
        } catch {
          elementCount = -1; // 无法检测
        }
      }
    }
    result.elementCount = elementCount;

    // 截图
    try {
      if (!fs.existsSync(CONFIG.screenshotDir)) {
        fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
      }
      const screenshotPath = path.join(CONFIG.screenshotDir, `${name.replace(/[/\\]/g, '_')}.png`);
      await withTimeout(currentPage.screenshot({ path: screenshotPath }), 10000, 'screenshot');
      result.screenshot = screenshotPath;
    } catch {}

    // 判断状态
    if (elementCount === 0) {
      result.status = 'blank';
      bugs.push({ page: name, url, severity: 'critical', description: '页面白屏，无任何元素渲染' });
    } else if (elementCount === -1) {
      result.status = 'unknown_elements';
    } else {
      result.status = 'loaded';
    }

    // 检查特定页面数据
    if (options.checkData && result.pageData) {
      const dataBugs = options.checkData(result.pageData, name);
      dataBugs.forEach((b) => bugs.push(b));
    }

    console.log(`  状态: ${result.status}, 元素数: ${elementCount}, 数据字段: [${result.dataKeys.join(', ')}]`);
    if (result.dataSummary && result.dataSummary !== '获取失败') {
      console.log(`  数据摘要: ${result.dataSummary.substring(0, 200)}`);
    }
  } catch (e) {
    result.status = 'exception';
    result.errors.push('测试异常: ' + e.message);
    bugs.push({ page: name, url, severity: 'critical', description: `测试执行异常: ${e.message}` });
  }

  pageResults.push(result);
  return result;
}

async function runSmokeTest() {
  console.log('='.repeat(70));
  console.log('邻里互助小程序 - 全功能冒烟测试');
  console.log('='.repeat(70));
  console.log(`WebSocket: ${CONFIG.wsEndpoint}`);
  console.log(`API地址: ${CONFIG.apiBaseUrl}`);
  console.log(`时间: ${new Date().toLocaleString()}`);
  console.log('');

  let mp;
  try {
    console.log('正在连接微信开发者工具...');
    // 优先尝试 connect 到已运行的 DevTools 自动化端口
    try {
      mp = await withTimeout(automator.connect({ wsEndpoint: CONFIG.wsEndpoint }), 15000, 'connect');
      console.log('✓ connect 成功（连接到已运行的 DevTools）\n');
    } catch (connErr) {
      console.log(`  connect 失败(${connErr.message})，回退到 launch...`);
      mp = await withTimeout(
        automator.launch({ cliPath: CONFIG.cliPath, projectPath: CONFIG.projectPath, timeout: 60000 }),
        120000, 'launch'
      );
      console.log('✓ launch 成功\n');
    }

    // === 第一步：测试登录 ===
    console.log('=== 第一步：测试登录 ===');
    const loginResult = await doTestLogin();
    if (loginResult.success) {
      await setTokensToStorage(mp, loginResult.data);
    } else {
      bugs.push({
        page: '登录', url: '/auth/test-login', severity: 'critical',
        description: `测试登录失败: ${JSON.stringify(loginResult.error).substring(0, 200)}`,
      });
    }

    // === 第二步：逐页冒烟测试 ===
    console.log('\n=== 第二步：逐页冒烟测试 ===');

    await testPage(mp, '首页', '/pages/index/index');
    await testPage(mp, '任务列表', '/pages/task/list', { wait: 3000 });
    await testPage(mp, '任务详情', '/pages/task/detail?id=1', { wait: 3000 });
    await testPage(mp, '发布任务', '/pages/task/publish');
    await testPage(mp, '聊天列表', '/pages/chat/list', { wait: 3000 });
    await testPage(mp, '聊天页', '/pages/chat/chat?targetUserId=test', { wait: 2000 });
    await testPage(mp, '个人中心', '/pages/user/profile', { wait: 3000 });
    await testPage(mp, '钱包', '/pages/user/wallet', { wait: 3000 });
    await testPage(mp, '设置', '/pages/user/settings');
    await testPage(mp, '我的评价', '/pages/user/reviews', { wait: 3000 });
    await testPage(mp, '创建评价', '/pages/review/create?orderId=1', { wait: 2000 });
    await testPage(mp, '订单详情', '/pages/order/detail?id=1', { wait: 3000 });
    await testPage(mp, '帮助者中心', '/pages/helper/index', { wait: 3000 });
    await testPage(mp, '搜索', '/pages/search/index', { wait: 2000 });
    await testPage(mp, '地图选择', '/pages/map/picker', { wait: 2000 });
    await testPage(mp, '登录页', '/pages/auth/login');

    // === 第三步：交互测试 ===
    console.log('\n=== 第三步：关键交互测试 ===');

    // 首页 → 附近任务按钮
    console.log('\n[交互] 首页"附近任务"按钮');
    try {
      await withTimeout(mp.reLaunch('/pages/index/index'), 10000, 'relaunch index');
      await sleep(1500);
      const stack = await withTimeout(mp.pageStack, 5000, 'stack');
      const page = stack[0];
      if (page) {
        try {
          const btn = await withTimeout(page.$('.nearby-btn'), 5000, '$nearby-btn');
          if (btn) {
            await withTimeout(btn.tap(), 5000, 'tap');
            await sleep(1500);
            const stack2 = await withTimeout(mp.pageStack, 5000, 'stack2');
            const top = stack2[stack2.length - 1];
            if (top && top.path && top.path.includes('task/list')) {
              console.log('  ✓ 附近任务按钮跳转成功');
            } else {
              console.log('  ✗ 附近任务按钮跳转异常，当前页: ' + (top && top.path));
              bugs.push({ page: '首页', url: '/pages/index/index', severity: 'high', description: '点击"附近任务"按钮未跳转到任务列表' });
            }
          } else {
            console.log('  - 未找到附近任务按钮');
          }
        } catch (e) {
          console.log('  - 按钮交互异常: ' + e.message);
        }
      }
    } catch (e) {
      console.log('  - 交互测试异常: ' + e.message);
    }

    // 登录页 → 登录按钮存在性
    console.log('\n[交互] 登录页按钮检查');
    try {
      await withTimeout(mp.reLaunch('/pages/auth/login'), 10000, 'relaunch login');
      await sleep(1500);
      const stack = await withTimeout(mp.pageStack, 5000, 'stack');
      const page = stack[stack.length - 1];
      if (page) {
        try {
          const loginBtn = await withTimeout(page.$('.login-btn'), 5000, '$login-btn');
          if (loginBtn) {
            console.log('  ✓ 登录按钮存在');
          } else {
            console.log('  ✗ 登录按钮不存在');
            bugs.push({ page: '登录页', url: '/pages/auth/login', severity: 'high', description: '登录按钮(.login-btn)未找到' });
          }
        } catch (e) {
          console.log('  - 登录按钮查询异常: ' + e.message);
        }
      }
    } catch (e) {
      console.log('  - 登录页交互异常: ' + e.message);
    }

  } catch (e) {
    console.error('\n❌ 测试执行失败:', e.message);
    bugs.push({ page: '全局', url: '', severity: 'critical', description: `测试框架异常: ${e.message}` });
  } finally {
    if (mp) {
      console.log('\n正在断开连接...');
      await mp.close().catch(() => {});
    }
  }

  printReport();
  saveReport();
}

function printReport() {
  console.log('\n' + '='.repeat(70));
  console.log('冒烟测试结果汇总');
  console.log('='.repeat(70));

  const loaded = pageResults.filter((r) => r.status === 'loaded').length;
  const blank = pageResults.filter((r) => r.status === 'blank').length;
  const failed = pageResults.filter((r) => r.status === 'nav_failed' || r.status === 'exception').length;
  const unknown = pageResults.filter((r) => r.status === 'unknown_elements').length;

  console.log(`\n页面测试: 共 ${pageResults.length} 页`);
  console.log(`  ✅ 已加载: ${loaded}`);
  console.log(`  ⚠️  元素检测未知: ${unknown}`);
  console.log(`  ❌ 白屏: ${blank}`);
  console.log(`  ❌ 加载失败: ${failed}`);

  console.log(`\n发现问题: ${bugs.length} 个`);
  const critical = bugs.filter((b) => b.severity === 'critical');
  const high = bugs.filter((b) => b.severity === 'high');
  const medium = bugs.filter((b) => b.severity === 'medium');
  const low = bugs.filter((b) => b.severity === 'low');
  console.log(`  🔴 严重(Critical): ${critical.length}`);
  console.log(`  🟠 高(High): ${high.length}`);
  console.log(`  🟡 中(Medium): ${medium.length}`);
  console.log(`  🟢 低(Low): ${low.length}`);

  if (bugs.length > 0) {
    console.log('\n--- 问题清单 ---');
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    bugs.sort((a, b) => order[a.severity] - order[b.severity]).forEach((b, i) => {
      const icon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[b.severity];
      console.log(`\n${i + 1}. ${icon} [${b.severity}] ${b.page}`);
      console.log(`   ${b.description}`);
      if (b.url) console.log(`   URL: ${b.url}`);
    });
  }

  // 页面详情
  console.log('\n--- 页面详情 ---');
  pageResults.forEach((r) => {
    const icon = r.status === 'loaded' ? '✅' : r.status === 'blank' ? '❌' : r.status === 'nav_failed' ? '❌' : '⚠️';
    console.log(`${icon} ${r.name} [${r.status}] 元素=${r.elementCount} 字段=[${r.dataKeys.join(',')}]`);
  });

  console.log('\n' + '='.repeat(70));
}

function saveReport() {
  const report = {
    timestamp: new Date().toISOString(),
    apiBaseUrl: CONFIG.apiBaseUrl,
    pageResults: pageResults.map((r) => ({
      name: r.name, url: r.url, status: r.status,
      elementCount: r.elementCount, dataKeys: r.dataKeys,
      dataSummary: r.dataSummary, errors: r.errors,
    })),
    bugs,
    summary: {
      totalPages: pageResults.length,
      loaded: pageResults.filter((r) => r.status === 'loaded').length,
      blank: pageResults.filter((r) => r.status === 'blank').length,
      failed: pageResults.filter((r) => r.status === 'nav_failed' || r.status === 'exception').length,
      totalBugs: bugs.length,
      critical: bugs.filter((b) => b.severity === 'critical').length,
      high: bugs.filter((b) => b.severity === 'high').length,
      medium: bugs.filter((b) => b.severity === 'medium').length,
      low: bugs.filter((b) => b.severity === 'low').length,
    },
  };
  const reportPath = path.join(__dirname, 'smoke-test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n报告已保存: ${reportPath}`);
}

runSmokeTest().then(() => {
  process.exit(bugs.length > 0 ? 1 : 0);
}).catch((e) => {
  console.error('致命错误:', e);
  process.exit(1);
});
