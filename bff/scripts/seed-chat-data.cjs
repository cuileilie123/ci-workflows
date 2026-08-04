/* 构造两个测试用户 + 多轮聊天消息，用于本地验证会话列表和聊天室 */
/* 运行：node bff/scripts/seed-chat-data.cjs */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ---- 加载 bff/.env ----
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { PrismaClient } = require('@prisma/client');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET || 'nh_dev_jwt_secret_2026_change_in_production';
const ACCESS_TTL = 2 * 60 * 60;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/neighborhood_help';

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function signJwt(payload, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + ttlSec };
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url(full);
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

const log = (m) => console.log('[seed-chat] ' + m);

// ---- 消息文档定义（与 message.schema.ts 对齐）----
function createMessageModel(conn) {
  const schema = new conn.Schema({
    conversationId: { type: String, index: true, required: true },
    senderId: { type: String, index: true, required: true },
    receiverId: { type: String, required: true },
    type: { type: String, default: 'TEXT' },
    content: { type: String, default: '' },
    metadata: { type: Object, default: null },
    readAt: { type: Date, default: null },
    clientMessageId: { type: String, default: null, sparse: true },
  }, { timestamps: true, collection: 'messages' });

  return conn.model('Message', schema);
}

(async () => {
  const prisma = new PrismaClient();
  let mongoConn = null;
  let Message = null;

  try {
    // 1. 确保两个测试用户存在
    const userA = await prisma.user.upsert({
      where: { openid: 'chat_test_user_a' },
      update: {},
      create: {
        openid: 'chat_test_user_a',
        nickname: '小李',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    log(`用户 A: id=${userA.id} 昵称=${userA.nickname}`);

    const userB = await prisma.user.upsert({
      where: { openid: 'chat_test_user_b' },
      update: {},
      create: {
        openid: 'chat_test_user_b',
        nickname: '小王',
        creditScore: 100,
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    log(`用户 B: id=${userB.id} 昵称=${userB.nickname}`);

    const idA = userA.id.toString();
    const idB = userB.id.toString();

    // 2. 连接 MongoDB
    log('连接 MongoDB: ' + MONGO_URL);
    mongoConn = await mongoose.connect(MONGO_URL);
    Message = createMessageModel(mongoConn);
    log('MongoDB 已连接');

    // 3. 清理旧测试消息
    const convIdA_B = `${idA}_${idB}`;
    const convIdB_A = `${idB}_${idA}`; // 与上面相同（确定性）
    const convId = idA < idB ? convIdA_B : convIdB_A;
    log(`会话 ID: ${convId}`);

    const delRes = await Message.deleteMany({ conversationId: convId });
    log(`清理旧消息: ${delRes.deletedCount} 条`);

    // 4. 插入多轮对话消息
    const now = new Date();
    const messages = [
      // A → B：打招呼
      {
        conversationId: convId,
        senderId: idA,
        receiverId: idB,
        type: 'TEXT',
        content: '你好，我想请你帮忙代拿一下快递，方便吗？',
        metadata: null,
        readAt: new Date(now.getTime() - 40 * 60 * 1000),
        createdAt: new Date(now.getTime() - 40 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 40 * 60 * 1000),
      },
      // B → A：回复
      {
        conversationId: convId,
        senderId: idB,
        receiverId: idA,
        type: 'TEXT',
        content: '可以的，快递在哪里？',
        metadata: null,
        readAt: new Date(now.getTime() - 38 * 60 * 1000),
        createdAt: new Date(now.getTime() - 38 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 38 * 60 * 1000),
      },
      // A → B：告知地点
      {
        conversationId: convId,
        senderId: idA,
        receiverId: idB,
        type: 'TEXT',
        content: '菜鸟驿站，在小区东门那边，取件码是 7-8-1234',
        metadata: null,
        readAt: new Date(now.getTime() - 36 * 60 * 1000),
        createdAt: new Date(now.getTime() - 36 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 36 * 60 * 1000),
      },
      // B → A：确认
      {
        conversationId: convId,
        senderId: idB,
        receiverId: idA,
        type: 'TEXT',
        content: '好的，我大概 20 分钟后到，送到你家门口可以吗？',
        metadata: null,
        readAt: new Date(now.getTime() - 35 * 60 * 1000),
        createdAt: new Date(now.getTime() - 35 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 35 * 60 * 1000),
      },
      // A → B：同意 + 位置
      {
        conversationId: convId,
        senderId: idA,
        receiverId: idB,
        type: 'LOCATION',
        content: '',
        metadata: {
          lat: 39.9042,
          lng: 116.4074,
          address: '北京市东城区某某小区 3 号楼 502',
        },
        readAt: new Date(now.getTime() - 34 * 60 * 1000),
        createdAt: new Date(now.getTime() - 34 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 34 * 60 * 1000),
      },
      // B → A：最新消息（未读）
      {
        conversationId: convId,
        senderId: idB,
        receiverId: idA,
        type: 'TEXT',
        content: '收到，马上出发！',
        metadata: null,
        readAt: null, // 未读
        createdAt: new Date(now.getTime() - 2 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 2 * 60 * 1000),
      },
    ];

    const inserted = await Message.insertMany(messages);
    log(`插入 ${inserted.length} 条消息成功`);

    // 5. 生成 JWT token
    const tokenA = signJwt(
      { sub: idA, role: 'USER', type: 'access' },
      JWT_SECRET,
      ACCESS_TTL,
    );
    const tokenB = signJwt(
      { sub: idB, role: 'USER', type: 'access' },
      JWT_SECRET,
      ACCESS_TTL,
    );

    log('--- 测试账号信息 ---');
    log(`用户 A: id=${idA} 昵称=小李 token=${tokenA}`);
    log(`用户 B: id=${idB} 昵称=小王 token=${tokenB}`);
    log(`会话 ID: ${convId}`);

    // 6. 验证查询
    const convMessages = await Message.find({ conversationId: convId }).sort({ createdAt: 1 });
    log(`验证查询：共 ${convMessages.length} 条消息`);
    convMessages.forEach((m) => {
      const sender = m.senderId === idA ? '小李' : '小王';
      const read = m.readAt ? '已读' : '未读';
      const preview =
        m.type === 'TEXT'
          ? m.content.slice(0, 30)
          : m.type === 'LOCATION'
            ? `[位置] ${m.metadata?.address ?? ''}`
            : `[${m.type}]`;
      log(`  ${sender} → ${m.receiverId === idA ? '小李' : '小王'} ${read} ${preview}`);
    });

    log('DONE — 请在微信开发者工具中测试聊天功能');
    log('提示：需要手动将 token 存入 wx.setStorageSync("nh_access_token", token)');
  } catch (e) {
    log('ERROR ' + (e.stack || e));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    if (mongoConn) {
      try {
        await mongoose.disconnect();
      } catch (_) {}
    }
  }
})();
