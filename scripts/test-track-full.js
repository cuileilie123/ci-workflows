/**
 * 全面测试埋点功能
 */

const http = require('http');

// 获取测试token
async function getTestToken() {
  console.log('🔑 获取测试用户Token...');
  
  const postData = JSON.stringify({
    nickname: '埋点测试用户'
  });

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/auth/test-login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.code === 0 && response.data) {
            console.log('✅ 获取Token成功');
            resolve(response.data.accessToken);
          } else {
            console.error('❌ 获取Token失败:', response);
            reject(new Error('Token获取失败'));
          }
        } catch (e) {
          console.error('❌ 解析响应失败:', e.message);
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      console.error('💥 请求错误:', e.message);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

// 发送多种类型的埋点事件
async function sendMultipleEvents(token) {
  console.log('🚀 开始发送多种埋点事件...');

  // 多种事件类型
  const eventData = {
    events: [
      {
        event: 'task_publish',
        props: {
          page: 'task_publish',
          category: 'DELIVERY',
          price: 15.5,
          userId: '123456'
        },
        userId: 123456,
        timestamp: Date.now(),
        sessionId: 'session_' + Date.now()
      },
      {
        event: 'page_view',
        props: {
          page: 'task_publish',
          duration: 30000 // 30秒停留
        },
        userId: 123456,
        timestamp: Date.now(),
        sessionId: 'session_' + Date.now()
      },
      {
        event: 'share_click',
        props: {
          page: 'task_detail',
          taskId: '789',
          shareType: 'friend'
        },
        userId: 123456,
        timestamp: Date.now(),
        sessionId: 'session_' + Date.now()
      },
      {
        event: 'order_accept',
        props: {
          taskId: '789',
          userId: '123456'
        },
        userId: 123456,
        timestamp: Date.now(),
        sessionId: 'session_' + Date.now()
      }
    ]
  };

  console.log('📊 发送埋点数据:', JSON.stringify(eventData, null, 2));

  // 发送埋点请求到BFF
  const postData = JSON.stringify(eventData);
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/v1/v1/track',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      console.log(`🎯 响应状态码: ${res.statusCode}`);
      
      res.on('data', (chunk) => {
        console.log('📋 响应内容:', chunk.toString());
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ 批量埋点上报成功！');
          resolve(true);
        } else {
          console.log('❌ 埋点上报失败！');
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (e) => {
      console.error('💥 请求错误:', e.message);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

// 检查BFF服务是否运行
function checkBFFService() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/health',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      if (res.statusCode === 200) {
        console.log('✅ BFF服务运行正常');
        resolve(true);
      } else {
        console.log('❌ BFF服务未运行或响应异常');
        resolve(false);
      }
    });

    req.on('error', () => {
      console.log('❌ 无法连接到BFF服务 (http://localhost:3000)');
      resolve(false);
    });

    req.end();
  });
}

// 主函数
async function main() {
  console.log('🔍 检查BFF服务状态...');
  const isBFFRunning = await checkBFFService();
  
  if (!isBFFRunning) {
    console.log('\n💡 提示：请先启动BFF服务');
    console.log('   命令: pnpm --filter bff start:dev');
    console.log('   或在另一个终端运行: cd bff && npm run start:dev');
    return;
  }

  console.log('\n🎬 开始全面测试埋点功能...');
  try {
    // 获取测试token
    const token = await getTestToken();
    console.log('🔐 使用Token:', token.substring(0, 20) + '...');
    
    // 发送多种事件
    await sendMultipleEvents(token);
    
    console.log('\n🎉 全面测试完成！');
    console.log('✅ 埋点功能工作正常');
    console.log('✅ 所有事件类型均可成功上报');
    console.log('✅ 批量上报功能正常');
  } catch (error) {
    console.error('\n💥 测试失败:', error.message);
  }
}

// 运行测试
if (require.main === module) {
  main();
}

module.exports = { sendMultipleEvents, checkBFFService, getTestToken };