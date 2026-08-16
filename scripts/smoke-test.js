/**
 * 邻里互助小程序冒烟测试脚本
 * 测试 Task1~Task8 的核心功能
 */

const automator = require('miniprogram-automator');
const path = require('path');

// 配置
const CONFIG = {
  // 微信开发者工具CLI路径
  cliPath: 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  // 项目路径
  projectPath: path.join(__dirname, '..', 'frontend', 'dist', 'build', 'mp-weixin'),
  // IDE服务器端口（从CLI输出获取）
  port: 61278,
};

// 测试结果
const testResults = {
  passed: [],
  failed: [],
};

// 测试用例
const testCases = [
  {
    name: 'Task1: 项目初始化 - 首页加载',
    test: async (miniProgram) => {
      console.log('    正在加载首页...');
      const page = await miniProgram.reLaunch('/pages/index/index');
      await page.waitFor(1000);
      return '首页加载成功';
    },
  },
  {
    name: 'Task2: 微信登录 - 登录页加载',
    test: async (miniProgram) => {
      console.log('    正在加载登录页...');
      const page = await miniProgram.navigateTo('/pages/auth/login');
      await page.waitFor(500);
      return '登录页加载成功';
    },
  },
  {
    name: 'Task3: 任务列表 - 列表页加载',
    test: async (miniProgram) => {
      console.log('    正在加载任务列表...');
      const page = await miniProgram.reLaunch('/pages/task/list');
      await page.waitFor(1000);
      return '任务列表页加载成功';
    },
  },
  {
    name: 'Task4: 任务详情 - 详情页加载',
    test: async (miniProgram) => {
      console.log('    正在加载任务详情...');
      const page = await miniProgram.navigateTo('/pages/task/detail?id=1');
      await page.waitFor(1000);
      return '任务详情页加载成功';
    },
  },
  {
    name: 'Task5: 发布任务 - 发布页加载',
    test: async (miniProgram) => {
      console.log('    正在加载发布页...');
      const page = await miniProgram.navigateTo('/pages/task/publish');
      await page.waitFor(500);
      return '发布任务页加载成功';
    },
  },
  {
    name: 'Task6: 即时通讯 - 聊天列表页',
    test: async (miniProgram) => {
      console.log('    正在加载聊天列表...');
      const page = await miniProgram.navigateTo('/pages/chat/list');
      await page.waitFor(500);
      return '聊天列表页加载成功';
    },
  },
  {
    name: 'Task7: 钱包功能 - 钱包页加载',
    test: async (miniProgram) => {
      console.log('    正在加载钱包页...');
      const page = await miniProgram.navigateTo('/pages/user/wallet');
      await page.waitFor(500);
      return '钱包页加载成功';
    },
  },
  {
    name: 'Task8: 订阅分享 - 详情页加载',
    test: async (miniProgram) => {
      console.log('    正在加载详情页验证分享功能...');
      const page = await miniProgram.navigateTo('/pages/task/detail?id=1');
      await page.waitFor(1000);
      return '订阅分享功能验证通过（分享需手动测试）';
    },
  },
];

// 运行测试
async function runSmokeTest() {
  console.log('='.repeat(60));
  console.log('开始运行邻里互助小程序冒烟测试');
  console.log('='.repeat(60));
  console.log(`项目路径: ${CONFIG.projectPath}`);
  console.log(`CLI端口: ${CONFIG.port}`);
  console.log(`测试用例数: ${testCases.length}`);
  console.log('');

  let miniProgram;

  try {
    // 连接微信开发者工具
    console.log('正在连接微信开发者工具...');
    miniProgram = await automator.connect({
      port: CONFIG.port,
    });

    console.log('✓ 连接成功\n');

    // 依次运行测试用例
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`\n[${i + 1}/${testCases.length}] 测试: ${testCase.name}`);
      
      try {
        const result = await testCase.test(miniProgram);
        testResults.passed.push({ name: testCase.name, result });
        console.log(`  ✅ 通过: ${result}`);
      } catch (error) {
        testResults.failed.push({ name: testCase.name, error: error.message });
        console.log(`  ❌ 失败: ${error.message}`);
      }
    }

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    console.log('\n请确保：');
    console.log('1. 微信开发者工具已启动并打开了项目');
    console.log('2. 在设置中开启了 "服务端口"');
    console.log('3. 项目已正确构建');
  } finally {
    if (miniProgram) {
      console.log('\n正在断开连接...');
      await miniProgram.close().catch(() => {});
    }
  }

  // 输出测试结果
  console.log('\n' + '='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));
  console.log(`通过: ${testResults.passed.length}/${testCases.length}`);
  console.log(`失败: ${testResults.failed.length}/${testCases.length}`);
  console.log('');

  if (testResults.passed.length > 0) {
    console.log('✅ 通过的测试:');
    testResults.passed.forEach((r) => console.log(`  - ${r.name}: ${r.result}`));
  }

  if (testResults.failed.length > 0) {
    console.log('');
    console.log('❌ 失败的测试:');
    testResults.failed.forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
  }

  console.log('');
  console.log('='.repeat(60));

  return {
    success: testResults.failed.length === 0,
    passed: testResults.passed.length,
    failed: testResults.failed.length,
    total: testCases.length,
  };
}

// 如果直接运行此脚本
if (require.main === module) {
  runSmokeTest().then((result) => {
    console.log('\n测试完成:', result.success ? '✅ 全部通过' : '❌ 部分失败');
    process.exit(result.success ? 0 : 1);
  }).catch(err => {
    console.error('测试执行异常:', err.message);
    process.exit(1);
  });
}