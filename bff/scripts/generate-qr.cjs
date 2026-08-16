const os = require('os');

// 获取局域网 IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const ip = getLocalIP();
const healthUrl = `http://${ip}:3000/api/v1/health`;

console.log('📱 手机健康检查地址:');
console.log(healthUrl);
console.log('\n👉 请在手机浏览器中打开此地址');
console.log('\n⚠️  如果打不开，请检查：');
console.log('   1. 手机和电脑是否在同一 WiFi？');
console.log('   2. Windows 防火墙是否放行了 3000 端口？');
