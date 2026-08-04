/* 向真实登录用户写入测试消息，用于前端验证 */
/* 运行：node bff/scripts/seed-real-user-chat.cjs */
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

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/neighborhood_help';

const log = (m) => console.log('[seed-real] ' + m);

// ---- 消息文档定义 ----
function createMessageModel(conn) {
  const schema = new conn.Schema({
    conversationId: { type: String, index: true, required: true },
    senderId: { type: String, index: true, required: true },
    receiverId: { type: String, required: true },
    type: { type: String, default: 'TEXT' },
    content: { type: String, default: '' },
    metadata: { type: Object, default: null },
    readAt: { type: Date, default: null },
    clientMessageId: { type: String, default: null },
  }, { timestamps: true, collection: 'messages' });

  return conn.model('Message', schema);
}

(async () => {
  const prisma = new PrismaClient();
  let mongoConn = null;
  let Message = null;

  try {
    // 1. 查询最近登录的真实用户（排除测试账号）
    const realUsers = await prisma.user.findMany({
      where: {
        AND: [
          { openid: { not: 'chat_test_user_a' } },
          { openid: { not: 'chat_test_user_b' } },
          { openid: { not: 'smoke_test_openid' } },
        ],
      },
      orderBy: { lastLoginAt: 'desc' },
      take: 5,
    });

    if (!realUsers.length) {
      log('没有找到真实登录用户，请先在微信开发者工具中登录');
      process.exit(0);
    }

    log(`找到 ${realUsers.length} 个真实用户：`);
    realUsers.forEach((u) => log(`  id=${u.id} 昵称=${u.nickname} openid=${u.openid.slice(0, 10)}...`));

    // 2. 创建/获取测试客服账号
    const testService = await prisma.user.upsert({
      where: { openid: 'test_service_account' },
      update: {},
      create: {
        openid: 'test_service_account',
        nickname: '平台客服',
        creditScore: 100,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    log(`测试客服账号: id=${testService.id} 昵称=${testService.nickname}`);

    // 3. 连接 MongoDB
    log('连接 MongoDB: ' + MONGO_URL);
    mongoConn = await mongoose.connect(MONGO_URL);
    Message = createMessageModel(mongoConn);
    log('MongoDB 已连接');

    // 4. 为每个真实用户创建对话
    const serviceId = testService.id.toString();
    const now = new Date();

    for (const user of realUsers) {
      const userId = user.id.toString();
      const convId = userId < serviceId ? `${userId}_${serviceId}` : `${serviceId}_${userId}`;

      // 清理旧测试消息
      await Message.deleteMany({ conversationId: convId });

      // 插入欢迎消息
      const messages = [
        {
          conversationId: convId,
          senderId: serviceId,
          receiverId: userId,
          type: 'TEXT',
          content: `您好，${user.nickname}！欢迎使用邻里互助平台。如有问题请随时联系客服。`,
          metadata: null,
          readAt: null, // 未读，让用户看到红点
          createdAt: new Date(now.getTime() - 5 * 60 * 1000), // 5 分钟前
          updatedAt: new Date(now.getTime() - 5 * 60 * 1000),
        },
        {
          conversationId: convId,
          senderId: serviceId,
          receiverId: userId,
          type: 'TEXT',
          content: '您可以在「附近任务」中浏览或发布任务，也可以通过聊天与对方沟通任务细节。',
          metadata: null,
          readAt: null,
          createdAt: new Date(now.getTime() - 4 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 4 * 60 * 1000),
        },
        {
          conversationId: convId,
          senderId: serviceId,
          receiverId: userId,
          type: 'TEXT',
          content: '祝您使用愉快！🎉',
          metadata: null,
          readAt: null,
          createdAt: new Date(now.getTime() - 3 * 60 * 1000),
          updatedAt: new Date(now.getTime() - 3 * 60 * 1000),
        },
      ];

      await Message.insertMany(messages);
      log(`✅ 已为用户 ${user.nickname}(id=${userId}) 创建 ${messages.length} 条消息，会话 ID: ${convId}`);
    }

    log('DONE — 请在微信开发者工具中刷新消息列表页');
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