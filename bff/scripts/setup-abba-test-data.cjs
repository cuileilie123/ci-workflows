/* 准备 AB-BA 死锁复现测试数据：
 *   - 按固定 openid 创建用户 A / B（已存在则复用）
 *   - 初始化双方钱包余额各 10000 元
 *   - 使用与 AuthModule 相同的 JWT_SECRET 签发 2h 有效 access_token
 * 运行（在 bff 目录下）：
 *   node scripts/setup-abba-test-data.cjs
 * 输出示例：
 *   USER_A_ID=1001
 *   USER_A_TOKEN=eyJhbGc...
 *   USER_B_ID=1002
 *   USER_B_TOKEN=eyJhbGc...
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
let signJwt;
try {
  // @nestjs/jwt 会把 jsonwebtoken 作为依赖安装；若顶层 require 成功则直接用
  const jwt = require('jsonwebtoken');
  signJwt = (payload, secret, options) => jwt.sign(payload, secret, options);
} catch (e) {
  // 回退：用 Node 内建 crypto 实现 HS256 JWT 签名（零依赖）
  const crypto = require('crypto');
  const toB64u = (buf) =>
    buf
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  signJwt = (payload, secret, options) => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const p = Object.assign({}, payload);
    const nowSec = Math.floor(Date.now() / 1000);
    if (options && typeof options.expiresIn === 'number') {
      p.exp = nowSec + options.expiresIn;
    }
    p.iat = nowSec;
    const encoded =
      toB64u(Buffer.from(JSON.stringify(header), 'utf8')) +
      '.' +
      toB64u(Buffer.from(JSON.stringify(p), 'utf8'));
    const sig = crypto
      .createHmac('sha256', secret)
      .update(encoded)
      .digest();
    return encoded + '.' + toB64u(sig);
  };
}

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const JWT_SECRET =
  process.env.JWT_SECRET || 'nh_dev_jwt_secret_2026_change_in_production';
const ACCESS_TTL_SEC = 2 * 60 * 60; // 与 auth.service.ts 一致
const INITIAL_BALANCE = 10000;
const TEST_PREFIX = 'abba_lock_fix_test';
const OPENID_A = `${TEST_PREFIX}_userA`;
const OPENID_B = `${TEST_PREFIX}_userB`;

function signToken(sub) {
  return signJwt(
    { sub: String(sub), role: 'USER', type: 'access' },
    JWT_SECRET,
    { expiresIn: ACCESS_TTL_SEC },
  );
}

async function upsertUserWithWallet(prisma, openid, nickname) {
  const existing = await prisma.user.findUnique({
    where: { openid },
    include: { wallet: true },
  });
  if (existing) {
    // 重置钱包余额，保证测试起点对称
    const wallet =
      existing.wallet ||
      (await prisma.wallet.create({
        data: {
          userId: existing.id,
          balance: new Prisma.Decimal(INITIAL_BALANCE),
          frozen: new Prisma.Decimal(0),
        },
      }));
    if (!existing.wallet) {
      existing.wallet = wallet;
    } else {
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: new Prisma.Decimal(INITIAL_BALANCE),
          frozen: new Prisma.Decimal(0),
        },
      });
      // 顺带清空之前的测试流水，方便数对
      await prisma.transaction.deleteMany({ where: { walletId: wallet.id } });
    }
    return existing;
  }
  return prisma.user.create({
    data: {
      openid,
      nickname,
      creditScore: 100,
      role: 'USER',
      status: 'ACTIVE',
      wallet: {
        create: {
          balance: new Prisma.Decimal(INITIAL_BALANCE),
          frozen: new Prisma.Decimal(0),
        },
      },
    },
    include: { wallet: true },
  });
}

(async () => {
  const prisma = new PrismaClient();
  try {
    console.log('');
    console.log('======== AB-BA 死锁测试 数据准备 ========');
    console.log(`JWT_SECRET 长度: ${JWT_SECRET.length}`);

    const a = await upsertUserWithWallet(prisma, OPENID_A, 'ABBA-测试用户A');
    const b = await upsertUserWithWallet(prisma, OPENID_B, 'ABBA-测试用户B');

    const tokA = signToken(a.id);
    const tokB = signToken(b.id);

    console.log('');
    console.log('✅ 用户A  userId=', a.id.toString(), '余额=', Number(a.wallet.balance));
    console.log('✅ 用户B  userId=', b.id.toString(), '余额=', Number(b.wallet.balance));
    console.log('');
    console.log('======== 环境变量 / 供双终端脚本使用 ========');
    console.log(`$env:USER_A_ID='${a.id.toString()}'`);
    console.log(`$env:USER_B_ID='${b.id.toString()}'`);
    console.log(`$env:USER_A_TOKEN='${tokA}'`);
    console.log(`$env:USER_B_TOKEN='${tokB}'`);
    console.log(`$env:BASE_URL='http://localhost:3000'`);
    console.log('');
    console.log('======== 复制以下 6 行到两个 PowerShell 终端（两边都要设） ========');
    console.log(
      [
        `$env:USER_A_ID='${a.id.toString()}';`,
        `$env:USER_B_ID='${b.id.toString()}';`,
        `$env:USER_A_TOKEN='${tokA}';`,
        `$env:USER_B_TOKEN='${tokB}';`,
        `$env:BASE_URL='http://localhost:3000';`,
      ].join(' '),
    );
    console.log('');
    console.log('======== 校验指纹（避免复现脚本跑时用错用户） ========');
    const payload = { a: a.id.toString(), b: b.id.toString() };
    console.log(
      'ABBA_FINGERPRINT=' +
        crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 8),
    );

    // 同时把环境变量写入一个 PowerShell 脚本，方便新开窗口一键 source
    const ps1Lines = [
      '# 由 scripts/setup-abba-test-data.cjs 自动生成，请勿手动编辑',
      `$env:USER_A_ID='${a.id.toString()}'`,
      `$env:USER_B_ID='${b.id.toString()}'`,
      `$env:USER_A_TOKEN='${tokA.replace(/'/g, "''")}'`,
      `$env:USER_B_TOKEN='${tokB.replace(/'/g, "''")}'`,
      `$env:BASE_URL='http://localhost:3000'`,
      '# 校验指纹',
      `Write-Host ('ABBA_FINGERPRINT=' + '${crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 8)}') -ForegroundColor DarkGray`,
    ];
    const outPath = path.join(__dirname, '_abba_env.ps1');
    fs.writeFileSync(outPath, '\ufeff' + ps1Lines.join('\r\n') + '\r\n', 'utf8');
    console.log('');
    console.log(`✅ 环境变量已持久化到：${outPath}`);
    console.log('   新开 PowerShell 窗口可运行：  . ' + outPath + '   即可一键加载所有变量。');
  } finally {
    await prisma.$disconnect();
  }
})();
