/**
 * 查找微信开发者工具路径
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('正在查找微信开发者工具...\n');

// 常见的安装路径
const possiblePaths = [
  'C:\\Program Files (x86)\\Tencent\\微信开发者工具',
  'C:\\Program Files\\Tencent\\微信开发者工具',
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具',
  'C:\\Program Files\\Tencent\\微信web开发者工具',
  'D:\\Program Files (x86)\\Tencent\\微信开发者工具',
  'D:\\Program Files\\Tencent\\微信开发者工具',
  path.join(process.env.LOCALAPPDATA || '', 'Tencent\\微信开发者工具'),
  path.join(process.env.LOCALAPPDATA || '', 'Tencent\\微信web开发者工具'),
];

let foundPath = null;
let cliPath = null;
let exePath = null;

for (const basePath of possiblePaths) {
  if (fs.existsSync(basePath)) {
    console.log(`✓ 找到基础路径: ${basePath}`);
    foundPath = basePath;
    
    // 查找cli.cmd
    const cliCmd = path.join(basePath, 'cli.cmd');
    if (fs.existsSync(cliCmd)) {
      cliPath = cliCmd;
      console.log(`  ✓ 找到CLI: ${cliCmd}`);
    }
    
    // 查找exe
    const exeFiles = ['微信开发者工具.exe', '微信web开发者工具.exe', 'wechat_devtools.exe'];
    for (const exe of exeFiles) {
      const exeFile = path.join(basePath, exe);
      if (fs.existsSync(exeFile)) {
        exePath = exeFile;
        console.log(`  ✓ 找到EXE: ${exeFile}`);
        break;
      }
    }
    console.log('');
  }
}

// 尝试通过注册表查找
if (!foundPath) {
  console.log('尝试通过注册表查找...');
  try {
    const regQuery = execSync(
      'reg query "HKEY_CURRENT_USER\\Software\\Tencent\\WechatDevTools" /v "InstallPath" 2>nul || reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Tencent\\WechatDevTools" /v "InstallPath" 2>nul',
      { encoding: 'utf-8' }
    );
    const match = regQuery.match(/InstallPath\s+REG_SZ\s+(.+)/);
    if (match) {
      foundPath = match[1].trim();
      console.log(`✓ 通过注册表找到: ${foundPath}`);
    }
  } catch (e) {
    console.log('注册表中未找到微信开发者工具');
  }
}

// 检查是否有正在运行的进程
console.log('\n检查是否有正在运行的微信开发者工具进程...');
try {
  const tasklist = execSync('tasklist /FI "IMAGENAME eq wechat_devtools.exe" /FO CSV', { encoding: 'utf-8' });
  if (tasklist.includes('wechat_devtools.exe')) {
    console.log('✓ 微信开发者工具正在运行中');
  } else {
    console.log('微信开发者工具未运行');
  }
} catch (e) {
  console.log('无法检查进程状态');
}

console.log('\n' + '='.repeat(60));
console.log('查找结果');
console.log('='.repeat(60));

if (foundPath) {
  console.log(`\n✅ 找到微信开发者工具: ${foundPath}`);
  if (cliPath) {
    console.log(`\nCLI路径: ${cliPath}`);
    console.log(`\n使用方式:`);
    console.log(`  ${cliPath} --open "d:\\neighborhood-help\\frontend\\dist\\build\\mp-weixin"`);
  }
  if (exePath) {
    console.log(`\nEXE路径: ${exePath}`);
    console.log(`\n手动启动方式:`);
    console.log(`  1. 双击运行: ${exePath}`);
    console.log(`  2. 或在微信开发者工具中导入项目: d:\\neighborhood-help\\frontend\\dist\\build\\mp-weixin`);
  }
} else {
  console.log('\n❌ 未找到微信开发者工具');
  console.log('\n请手动安装或确认安装路径:');
  console.log('  下载地址: https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html');
}

console.log('\n' + '='.repeat(60));