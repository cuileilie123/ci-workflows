---
name: im-websocket
description: 实现 WebSocket 即时通讯服务（连接管理+消息路由+持久化）
model: claude-4-sonnet
tags: [bff, im]
depends_on: [nestjs-init, wx-login-gateway]
---

# 任务：实现 IM WebSocket 服务

## 目标
搭建 WebSocket 长连接服务，支持文本/图片/位置消息，持久化到 MongoDB，支持离线消息推送。

## 具体步骤

### 1. 安装依赖
```bash
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io mongoose @nestjs/mongoose
```

### 2. 创建 `src/modules/chat/chat.gateway.ts`
```typescript
@WebSocketGateway({
  cors: { origin: 'https://servicewechat.com' },
  pingInterval: 30000,
  pingTimeout: 90000,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  
  private readonly connectedClients = new Map<string, string>(); // userId -> socketId
  
  async handleConnection(client: Socket) {
    // 1. 验证 JWT（从 handshake.auth.token 取）
    const token = client.handshake.auth.token;
    const payload = this.jwtService.verify(token);
    
    // 2. 检查 Redis 黑名单
    const blacklisted = await this.redis.sismember('token:blacklist', token);
    if (blacklisted) client.disconnect();
    
    // 3. 注册连接
    this.connectedClients.set(payload.sub, client.id);
    await this.redis.set(`online:${payload.sub}`, client.id, 'EX', 120);
    
    // 4. 推送离线消息
    await this.pushOfflineMessages(payload.sub, client);
  }
  
  async handleDisconnect(client: Socket) {
    const userId = this.getUserIdBySocket(client.id);
    if (userId) {
      this.connectedClients.delete(userId);
      await this.redis.del(`online:${userId}`);
    }
  }
  
  @SubscribeMessage('send_message')
  async handleMessage(@MessageBody() dto: SendMessageDto, @ConnectedSocket() client: Socket) {
    // 1. 敏感词过滤
    const filtered = this.sensitiveFilter.filter(dto.content);
    
    // 2. 持久化到 MongoDB
    const message = await this.messageModel.create({
      conversationId: dto.conversationId,
      senderId: dto.senderId,
      type: dto.type, // TEXT | IMAGE | VOICE | LOCATION | SYSTEM
      content: filtered,
      createdAt: new Date()
    });
    
    // 3. 查找接收方 socket
    const receiverSocket = this.connectedClients.get(dto.receiverId);
    if (receiverSocket) {
      // 在线 → 实时推送
      this.server.to(receiverSocket).emit('new_message', message);
      // 更新已读状态
      await this.messageModel.updateOne(
        { _id: message._id },
        { $set: { readAt: new Date() } }
      );
    } else {
      // 离线 → 存入离线队列（Redis List）
      await this.redis.lpush(`offline:${dto.receiverId}`, JSON.stringify(message));
    }
    
    return { status: 'ok', messageId: message._id };
  }
}
```

### 3. MongoDB Schema `chat/schemas/message.schema.ts`
```typescript
@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, index: true })
  conversationId: string;        // 会话ID = min(id1,id2)_max(id1,id2)
  
  @Prop({ required: true, index: true })
  senderId: number;
  
  @Prop({ required: true })
  receiverId: number;
  
  @Prop({ enum: ['TEXT','IMAGE','VOICE','LOCATION','SYSTEM'], default: 'TEXT' })
  type: string;
  
  @Prop({ default: '' })
  content: string;
  
  @Prop({ type: Object })
  metadata?: {         // 图片URL/语音时长/位置坐标
    url?: string;
    duration?: number;
    lat?: number;
    lng?: number;
    address?: string;
  };
  
  @Prop({ default: null })
  readAt: Date | null;
}

// TTL 索引：普通消息1年，系统消息永久
MessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000, partialFilterExpression: { type: { $ne: 'SYSTEM' } } });
MessageSchema.index({ conversationId: 1, createdAt: -1 });
```

### 4. 离线消息推送
```typescript
private async pushOfflineMessages(userId: string, client: Socket) {
  const key = `offline:${userId}`;
  const messages = await this.redis.lrange(key, 0, -1);
  if (messages.length > 0) {
    client.emit('offline_messages', messages.map(m => JSON.parse(m)));
    await this.redis.del(key);
  }
}
```

### 5. 敏感词过滤 `chat/services/sensitive-filter.service.ts`
```typescript
@Injectable()
export class SensitiveFilterService {
  private trie = new Trie();
  
  constructor() {
    // 加载敏感词库
    const words = fs.readFileSync('src/common/dict/sensitive_words.txt', 'utf-8').split('\n');
    words.forEach(w => this.trie.insert(w.trim()));
  }
  
  filter(text: string): string {
    return this.trie.replace(text, '***');
  }
  
  containsSensitive(text: string): boolean {
    return this.trie.search(text);
  }
}
```

### 6. 心跳保活
- 服务端 `pingInterval: 30000`（30秒）
- 客户端超时 `pingTimeout: 90000`（90秒无响应断开）
- 断线指数退避重连：1s → 2s → 4s → 8s → 16s（最大5次）

### 7. 创建 `src/modules/chat/chat.controller.ts`（REST 接口）
| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v1/chat/conversations` | 获取会话列表 |
| GET | `/api/v1/chat/messages/:convId` | 获取消息历史（分页） |
| POST | `/api/v1/chat/upload` | 上传聊天图片/语音 |
| PUT | `/api/v1/chat/read/:convId` | 标记会话已读 |

## 验收标准
- [ ] WebSocket 连接成功（JWT 验证通过）
- [ ] 心跳 30s 正常保活
- [ ] 断线 90s 自动断开
- [ ] 消息发送/接收实时（< 200ms）
- [ ] 离线消息登录后推送
- [ ] 敏感词替换为 ***
- [ ] 消息持久化到 MongoDB
- [ ] 图片/语音上传到 COS
- [ ] 已读回执生效

## 参考文件
- `specs/04-im.md` → 全部章节
- `.trae/memory.md` → 禁止事项 + 已知坑
