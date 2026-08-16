/**
 * 生成 TabBar 占位图标脚本
 * 运行方式: node scripts/generate-icons.js
 * 需要安装: npm install canvas
 */

const fs = require('fs');
const path = require('path');

// 检查 canvas 是否已安装
let createCanvas;
try {
  const { createCanvas: fn } = require('canvas');
  createCanvas = fn;
} catch (e) {
  console.log('⚠️  未安装 canvas 库，使用简化方案');
  console.log('请按照 README.md 中的说明手动准备图标');
  process.exit(0);
}

const ICON_SIZE = 81;
const OUTPUT_DIR = path.join(__dirname, '../static/tabbar');

// 图标配置
const icons = [
  { name: 'home', label: '首页', emoji: '🏠' },
  { name: 'task', label: '任务', emoji: '📋' },
  { name: 'chat', label: '消息', emoji: '💬' },
  { name: 'profile', label: '我的', emoji: '👤' },
];

function generateIcon(name, emoji, color, isActive = false) {
  const canvas = createCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas.getContext('2d');

  // 背景透明
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);

  // 绘制 emoji
  ctx.font = '40px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(emoji, ICON_SIZE / 2, ICON_SIZE / 2);

  // 保存
  const buffer = canvas.toBuffer('image/png');
  const suffix = isActive ? '-active' : '';
  const filePath = path.join(OUTPUT_DIR, `${name}${suffix}.png`);
  fs.writeFileSync(filePath, buffer);
  console.log(`✓ 生成: ${name}${suffix}.png`);
}

// 生成所有图标
icons.forEach(icon => {
  // 未选中状态（灰色）
  generateIcon(icon.name, icon.emoji, '#7A7E83', false);
  // 选中状态（绿色）
  generateIcon(icon.name, icon.emoji, '#4CAF50', true);
});

console.log('\n✅ 所有图标生成完成！');
console.log('📝 提示：这些是占位图标，建议联系设计师提供专业图标');
