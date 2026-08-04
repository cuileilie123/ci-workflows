# Task 006 · IM 即时通讯 — 详细设计文档

> 版本：v1.0 · 日期：2026-08-03
> 依赖：Task 002（微信登录 / JWT 鉴权）
> 参考：`specs/04-im.md`、`prompts/bff/05-im-websocket.prompt.md`、`.trae/memory.md`

---

## 一、概述与目标

为邻里互助平台提供用户间实时通讯能力，支撑「联系 TA」入口，打通任务协作闭环。

### 核心能力

| 能力 | 说明 |
|------|------|
| 实时消息 | 文本/图片/语音/位置/系统通知，端到端延迟 < 200ms |
| 连接保活 | 心跳 30s，超时 90s 断开，断线指数退避重连 |
| 离线消息 | 接收方离线时暂存，上线后自动推送 |
| 已读回执 | 在线直推即读，离线拉取后标记已读 |
| 敏感词过滤 | 文本命中敏感词替换为 `***` |
| 多端互斥 | 新设备登录踢掉旧设备连接 |
| 消息持久化 | MongoDB 存储，普通消息保留 1 年，系统消息永久 |

---

## 二、系统架构

```
┌─────────────────┐     wx.connectSocket      ┌──────────────────────────┐
│  微信小程序前端   │ ◄──────── WebSocket ──────► │  BFF (NestJS)            │
│                 │                            │  ┌────────────────────┐  │
│  chat-list.vue  │     REST /api/v1/chat/*    │  │ ChatGateway        │  │
│  chat.vue       │ ◄─────────────────────────►│  │  (Socket.IO)       │  │
│                 │                            │  ├────────────────────┤  │
│  socket.ts      │                            │  │ ChatController     │  │
│  (WS 客户端)    │                            │  │  (REST 接口)       │  │
└─────────────────┘                            │  ├────────────────────┤  │
                                               │  │ ChatService        │  │
                                               │  │ SensitiveService   │  │
                                               │  │ RedisService       │  │
                                               │  │ JwtService         │  │
                                               │  └────────────────────┘  │
                                               └───────┬──────────┬───────┘
                                                       │          │
                                          ┌────────────▼──┐  ┌───▼───────┐
                                          │  MongoDB      │  │  Redis    │
                                          │  messages 集合 │  │  在线/离线 │
                                          └───────────────┘  └───────────┘
```

### 分层职责

| 层 | 职责 |
|----|------|
| 前端 | 聊天 UI、WebSocket 客户端、消息发送/接收、断线重连 |
| BFF Gateway | WebSocket 连接管理、JWT 握手鉴权、消息路由、在线状态 |
| BFF Controller | REST 接口（会话列表、消息历史、上传、已读标记） |
| BFF Service | 业务逻辑（敏感词过滤、持久化、离线队列） |
| MongoDB | 消息持久化 |
| Redis | 在线状态、离线消息队列 |

---

## 三、技术选型与决策

### 3.1 WebSocket 协议选型

| 方案 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| **Socket.IO** | 自动重连、房间、ack 机制、降级兼容 | 小程序需适配库 | ✅ BFF 采用 |
| 原生 ws | 轻量、无依赖 | 需自建重连/ack 协议 | ❌ 放弃 |

**BFF**：`@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io@4`

**前端适配**（关键决策）：

微信小程序原生 `wx.connectSocket` 不兼容 Socket.IO 协议（Engine.IO 握手）。采用以下方案：

| 方案 | 说明 | 适用 |
|------|------|------|
| **方案 A（推荐）** | `weapp.socket.io` 库，Socket.IO 协议的小程序适配 | 生产 |
| 方案 B | uni-app 的 `uni.connectSocket` + 自定义 JSON 协议，BFF 改用原生 ws | 降级 |

> 决策：采用 **方案 A**。`weapp.socket.io` 封装了 `wx.connectSocket`，对外暴露与 `socket.io-client` 一致的 API，BFF 无需感知小程序环境。若适配库版本冲突，降级到方案 B。

### 3.2 消息存储选型

| 存储 | 用途 | 理由 |
|------|------|------|
| **MongoDB** | 消息持久化 | 文档模型适配消息结构、TTL 索引自动过期、写入性能优 |
| **Redis** | 在线状态 + 离线队列 | 高频读写、TTL 自动过期、List 结构天然适配消息队列 |
| MySQL | 不参与 | 聊天消息非关系型数据，避免写压力传导到业务库 |

### 3.3 会话 ID 规则

```
conversationId = `${min(uidA, uidB)}_${max(uidA, uidB)}`
```

- 确定性生成：同一对用户始终得到相同会话 ID
- 无需额外会话表：直接用 conversationId 作为 MongoDB 索引键
- 排序保证：min/max 确保双方视角一致

---

## 四、数据模型

### 4.1 MongoDB Message Schema

```typescript
// bff/src/modules/chat/schemas/message.schema.ts
@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  @Prop({ required: true, index: true })
  conversationId: string;        // `${min(uid)}_${max(uid)}`

  @Prop({ required: true, index: true })
  senderId: string;              // BigInt 序列化为 string（与现有约定一致）

  @Prop({ required: true })
  receiverId: string;

  @Prop({ enum: ['TEXT', 'IMAGE', 'VOICE', 'LOCATION', 'SYSTEM'], default: 'TEXT' })
  type: MessageType;

  @Prop({ default: '' })
  content: string;               // TEXT 的文本内容（已过滤敏感词）

  @Prop({ type: Object, default: null })
  metadata: {                    // 非文本消息的附加数据
    url?: string;                // IMAGE/VOICE 的 COS 链接
    duration?: number;           // VOICE 时长（秒）
    lat?: number;                // LOCATION 纬度
    lng?: number;                // LOCATION 经度
    address?: string;            // LOCATION 地址
  };

  @Prop({ default: null })
  readAt: Date | null;           // 已读时间，null = 未读

  @Prop({ default: null })
  clientMessageId: string | null; // 客户端幂等键，防重复
}
```

**索引设计**：

```javascript
// 复合索引：按会话查历史消息（倒序）
db.messages.createIndex({ conversationId: 1, createdAt: -1 });

// TTL 索引：普通消息 1 年自动过期，系统消息永久
db.messages.createIndex(
  { createdAt: 1 },
  {
    expireAfterSeconds: 31536000,   // 365 天
    partialFilterExpression: { type: { $ne: 'SYSTEM' } }
  }
);

// 幂等键索引：防重复消息
db.messages.createIndex(
  { clientMessageId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { clientMessageId: { $ne: null } } }
);
```

### 4.2 Redis 键设计

| Key | 类型 | TTL | 用途 |
|-----|------|-----|------|
| `online:{userId}` | String (socketId) | 120s | 在线状态 + 连接映射 |
| `offline:{userId}` | List | 无 | 离线消息队列（JSON 数组） |
| `chat:unread:{userId}` | String (count) | 无 | 未读消息总数（可选，加速角标） |

> 降级：Redis 不可用时（复用现有 `RedisService` 降级机制），在线状态检测跳过，消息一律走 MongoDB 持久化 + REST 拉取。

---

## 五、BFF 模块设计

### 5.1 目录结构

```
bff/src/modules/chat/
├── chat.module.ts
├── chat.gateway.ts            # WebSocket 网关（连接/消息路由）
├── chat.controller.ts         # REST 接口
├── chat.service.ts            # 业务逻辑
├── dto/
│   ├── send-message.dto.ts    # 发送消息入参
│   └── query-messages.dto.ts  # 查询历史入参
├── schemas/
│   └── message.schema.ts      # MongoDB Schema
└── types/
    └── message.type.ts        # 枚举/接口定义
```

### 5.2 ChatGateway（WebSocket 网关）

```typescript
@WebSocketGateway({
  cors: { origin: 'https://servicewechat.com' },
  pingInterval: 30000,   // 30s 心跳
  pingTimeout: 90000,    // 90s 超时断开
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {

  @WebSocketServer()
  server: Server;

  // userId → socketId 映射（内存态，断线即清）
  private readonly connectedClients = new Map<string, string>();
}
```

#### 连接生命周期

```typescript
async handleConnection(client: Socket): Promise<void> {
  // 1. 握手鉴权：从 handshake.auth.token 取 JWT
  const token = client.handshake.auth?.token;
  if (!token) { client.disconnect(); return; }

  // 2. 验证签名 + 黑名单（复用现有 JwtService + TokenBlacklistService）
  let payload: { sub: string };
  try {
    payload = this.jwtService.verify(token);
  } catch { client.disconnect(); return; }

  if (this.blacklist.isBlacklisted(token)) {
    client.disconnect(); return;
  }

  const userId = payload.sub;

  // 3. 多端互斥：踢掉旧连接
  const oldSocketId = this.connectedClients.get(userId);
  if (oldSocketId) {
    const oldSocket = this.server.sockets.sockets.get(oldSocketId);
    oldSocket?.emit('kicked', { reason: '另一设备登录' });
    oldSocket?.disconnect(true);
  }

  // 4. 注册连接
  this.connectedClients.set(userId, client.id);
  await this.redis.set(`online:${userId}`, client.id, 120);
  client.data.userId = userId;

  // 5. 推送离线消息
  await this.pushOfflineMessages(userId, client);
}

async handleDisconnect(client: Socket): Promise<void> {
  const userId = client.data.userId;
  if (userId) {
    // 仅当当前 socketId 匹配时才清除（避免被踢后误清新连接）
    if (this.connectedClients.get(userId) === client.id) {
      this.connectedClients.delete(userId);
      await this.redis.del(`online:${userId}`);
    }
  }
}
```

#### 消息发送

```typescript
@SubscribeMessage('send_message')
async handleMessage(
  @MessageBody() dto: SendMessageDto,
  @ConnectedSocket() client: Socket,
): Promise<{ status: 'ok'; messageId: string }> {
  const senderId = client.data.userId;

  // 1. 敏感词过滤（扩展 SensitiveService.filter）
  const filteredContent = dto.type === 'TEXT'
    ? this.sensitiveService.filter(dto.content)
    : dto.content;

  // 2. 持久化到 MongoDB（带 clientMessageId 幂等）
  const message = await this.chatService.createMessage({
    conversationId: this.buildConversationId(senderId, dto.receiverId),
    senderId,
    receiverId: dto.receiverId,
    type: dto.type,
    content: filteredContent,
    metadata: dto.metadata,
    clientMessageId: dto.clientMessageId,
  });

  // 3. 路由到接收方
  const receiverSocketId = this.connectedClients.get(dto.receiverId);
  if (receiverSocketId) {
    // 在线 → 实时推送 + 标记已读
    this.server.to(receiverSocketId).emit('new_message', message);
    await this.chatService.markRead(message.id);
  } else {
    // 离线 → 存入 Redis List
    await this.redis.lpush(
      `offline:${dto.receiverId}`,
      JSON.stringify(message),
    );
  }

  return { status: 'ok', messageId: message.id };
}
```

### 5.3 ChatController（REST 接口）

| Method | Path | 说明 | 入参 |
|--------|------|------|------|
| GET | `/api/v1/chat/conversations` | 会话列表（含最后一条消息、未读数） | — |
| GET | `/api/v1/chat/messages/:convId` | 消息历史（游标分页） | `?before=<isoDate>&limit=20` |
| POST | `/api/v1/chat/upload` | 上传图片/语音 | `multipart/form-data` |
| PUT | `/api/v1/chat/read/:convId` | 标记会话已读 | — |

#### 会话列表实现逻辑

```typescript
@Get('conversations')
async getConversations(@Req() req: AuthedRequest): Promise<ConversationSummary[]> {
  const userId = req.user.sub;
  // MongoDB aggregate: 按 conversationId 分组，取最后一条消息 + 未读数
  return this.chatService.getConversations(userId);
}
```

```javascript
// MongoDB 聚合管道
db.messages.aggregate([
  { $match: { $or: [{ senderId: userId }, { receiverId: userId }] } },
  { $sort: { createdAt: -1 } },
  {
    $group: {
      _id: '$conversationId',
      lastMessage: { $first: '$$ROOT' },
      unreadCount: {
        $sum: {
          $cond: [
            { $and: [{ $eq: ['$receiverId', userId] }, { $eq: ['$readAt', null] }] },
            1, 0
          ]
        }
      },
    },
  },
  { $sort: { 'lastMessage.createdAt': -1 } },
]);
```

#### 消息历史分页（游标式）

```typescript
@Get('messages/:convId')
async getMessages(
  @Param('convId') convId: string,
  @Query('before') before?: string,
  @Query('limit', new DefaultValuePipe(20)) limit: number,
): Promise<{ list: Message[]; hasMore: boolean }> {
  return this.chatService.getMessages(convId, before, limit);
}
```

```javascript
// 游标查询：加载早于 before 的消息
db.messages
  .find({
    conversationId: convId,
    createdAt: before ? { $lt: new Date(before) } : { $exists: true },
  })
  .sort({ createdAt: -1 })
  .limit(limit + 1)   // 多取 1 条判断 hasMore
```

### 5.4 DTO 定义

```typescript
// send-message.dto.ts
export class SendMessageDto {
  @IsString() @IsNotEmpty()
  receiverId: string;

  @IsEnum(['TEXT', 'IMAGE', 'VOICE', 'LOCATION'])
  type: MessageType;

  @IsString() @MaxLength(500)
  content: string;        // TEXT 必填，其他类型可空

  @IsOptional() @IsObject()
  metadata?: MessageMetadata;

  @IsOptional() @IsString()
  clientMessageId?: string;   // 幂等键
}
```

### 5.5 SensitiveService 扩展

现有 `SensitiveService` 仅有 `isSensitive()` / `checkAndThrow()`，需新增 `filter()` 方法：

```typescript
// bff/src/common/sensitive.service.ts 新增

/**
 * 替换文本中的敏感词为 ***（用于聊天消息）
 * 注意：当前用 Set 实现，复杂文本场景可后续升级为 Trie 树
 */
filter(text: string | undefined | null): string {
  if (!text) return '';
  let result = text;
  for (const w of this.words) {
    const re = new RegExp(w, 'gi');
    result = result.replace(re, '***');
  }
  return result;
}
```

### 5.6 模块注册

```typescript
// app.module.ts 新增
import { MongooseModule } from '@nestjs/mongoose';
import { ChatModule } from './modules/chat/chat.module';

@Module({
  imports: [
    // ... 现有模块
    MongooseModule.forRoot(process.env.MONGO_URL || 'mongodb://localhost:27017/neighborhood_help'),
    ChatModule,
  ],
})
```

---

## 六、消息协议（事件定义）

### 6.1 客户端 → 服务端

| 事件 | Payload | 说明 |
|------|---------|------|
| `send_message` | `SendMessageDto` | 发送消息 |
| `mark_read` | `{ conversationId: string }` | 标记会话已读 |
| `typing` | `{ receiverId: string, isTyping: boolean }` | 正在输入（可选） |

### 6.2 服务端 → 客户端

| 事件 | Payload | 说明 |
|------|---------|------|
| `new_message` | `Message` | 新消息（实时） |
| `offline_messages` | `Message[]` | 离线消息批量推送（连接时） |
| `message_read` | `{ conversationId: string, messageIds: string[] }` | 已读回执 |
| `kicked` | `{ reason: string }` | 被踢下线（多端互斥） |
| `connect_error` | `{ message: string }` | 连接错误 |

### 6.3 消息时序图

```
发送方                 BFF Gateway              接收方
  │                        │                       │
  │ emit('send_message')   │                       │
  │───────────────────────►│                       │
  │                        │ 过滤敏感词             │
  │                        │ 写 MongoDB            │
  │                        │                       │
  │                        │── 查 online ──►       │
  │                        │                       │
  │              ┌─────────┴─────────┐             │
  │              │                   │             │
  │       (在线) │            (离线)  │             │
  │              │                   │             │
  │              ▼                   ▼             │
  │  ack {messageId}        lpush offline:xxx      │
  │◄───────────────────────│                       │
  │                        │                       │
  │                        │ emit('new_message')   │ (上线时)
  │                        │──────────────────────►│
  │                        │                       │
  │                        │◄── emit('mark_read')──│
  │                        │ update readAt         │
  │                        │──────────────────────►│
```

---

## 七、连接管理

### 7.1 握手鉴权

```
前端：socket.auth = { token: getAccessToken() }
BFF：client.handshake.auth.token → JwtService.verify → TokenBlacklistService
```

复用现有 [JwtAuthGuard](file:///d:/neighborhood-help/bff/src/auth/guards/jwt-auth.guard.ts) 的验证逻辑（签名 + 黑名单），但需适配 WebSocket 握手场景（从 `handshake.auth` 取而非 `headers.authorization`）。

### 7.2 心跳保活

| 参数 | 值 | 说明 |
|------|----|------|
| `pingInterval` | 30000ms | 服务端发 ping 的间隔 |
| `pingTimeout` | 90000ms | 客户端 90s 未响应 pong 则断开 |

Socket.IO 内置心跳，无需业务层手动实现。`weapp.socket.io` 底层通过 `wx.onSocketMessage` 响应。

### 7.3 断线重连（前端）

```typescript
// 前端 socket.ts
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]; // 指数退避
let reconnectAttempt = 0;

function onDisconnect(reason: string): void {
  if (reason === 'io server disconnect') {
    // 服务端主动断开（如被踢），不重连
    return;
  }
  if (reconnectAttempt >= RECONNECT_DELAYS.length) {
    uni.showToast({ title: '连接已断开，请检查网络', icon: 'none' });
    return;
  }
  const delay = RECONNECT_DELAYS[reconnectAttempt++];
  setTimeout(() => connect(), delay);
}
```

### 7.4 多端互斥

新连接建立时，检查 `connectedClients` 是否已有该 userId 的旧连接：
- 有 → 向旧 socket 发 `kicked` 事件 → `disconnect(true)` → 注册新连接
- 无 → 直接注册

前端收到 `kicked` 事件后，Toast 提示「另一设备登录」并跳转登录页。

---

## 八、消息可靠性

### 8.1 发送确认（ack）

`send_message` 事件返回 `{ status: 'ok', messageId }`，前端收到 ack 后才将消息状态从「发送中」改为「已发送」。超时 5s 未收到 ack → 标记「发送失败」+ 允许重发。

### 8.2 幂等去重

客户端为每条消息生成 `clientMessageId`（UUID）。BFF 写入 MongoDB 时，利用唯一索引（sparse + unique）拦截重复消息。重发时服务端返回已存在的 messageId。

### 8.3 已读回执

| 场景 | 处理 |
|------|------|
| 接收方在线 | Gateway 推送后立即 `updateOne({ _id }, { $set: { readAt: new Date() } })` |
| 接收方离线 | 消息存入 `offline:{userId}`，`readAt = null` |
| 接收方上线 | 拉取离线消息后，前端发 `mark_read` 事件，BFF 批量更新 |

### 8.4 离线消息推送

```typescript
private async pushOfflineMessages(userId: string, client: Socket): Promise<void> {
  const key = `offline:${userId}`;
  const rawMessages = await this.redis.lrange(key, 0, -1);
  if (rawMessages.length === 0) return;

  const messages = rawMessages.map((m) => JSON.parse(m));
  client.emit('offline_messages', messages);
  await this.redis.del(key);

  // 批量标记已读（接收方已收到）
  const messageIds = messages.map((m) => m._id);
  await this.chatService.markReadBatch(messageIds);
}
```

> 降级：Redis 不可用时跳过离线推送，前端通过 REST 接口 `/messages/:convId` 拉取未读消息（`readAt = null`）。

---

## 九、敏感词过滤

### 9.1 文本消息

复用现有 [SensitiveService](file:///d:/neighborhood-help/bff/src/common/sensitive.service.ts)，新增 `filter()` 方法（替换为 `***`，非拦截）。

```typescript
// Gateway.handleMessage 中
const filteredContent = dto.type === 'TEXT'
  ? this.sensitiveService.filter(dto.content)
  : dto.content;
```

### 9.2 图片/语音（后续迭代）

- 图片：异步调用微信 `security.imgSecCheck`（需 access_token）→ 命中则撤回消息
- 语音：转文字后检测（依赖 ASR 服务，Task 006 范围外，预留接口）

---

## 十、前端设计

### 10.1 新增页面

| 页面 | 路径 | 功能 |
|------|------|------|
| 聊天列表 | `pages/chat/list.vue` | 会话列表（头像/昵称/最后消息/未读角标） |
| 聊天室 | `pages/chat/chat.vue` | 消息气泡、输入框、图片/语音发送 |

### 10.2 新增文件

```
frontend/src/
├── pages/
│   └── chat/
│       ├── list.vue          # 会话列表
│       └── chat.vue          # 聊天室
├── api/
│   └── chat.ts               # REST 接口封装
├── store/
│   └── chat.ts               # Pinia store（会话列表/未读数）
├── utils/
│   └── socket.ts             # WebSocket 客户端（单例）
└── types/
    └── chat.ts               # 消息/会话类型
```

### 10.3 Socket 客户端（socket.ts）

```typescript
// 伪代码：基于 weapp.socket.io 的单例封装
import io from 'weapp.socket.io';
import { getAccessToken } from '@/utils/request';

const WS_URL = import.meta.env.VITE_WS_URL; // wss://xxx/chat

let socket: Socket | null = null;

export function connect(): Socket {
  if (socket?.connected) return socket;

  socket = io(WS_URL, {
    auth: { token: getAccessToken() },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 16000,
  });

  socket.on('connect', () => { reconnectAttempt = 0; });
  socket.on('disconnect', onDisconnect);
  socket.on('kicked', onKicked);
  socket.on('new_message', onNewMessage);
  socket.on('offline_messages', onOfflineMessages);

  return socket;
}

export function sendMessage(dto: SendMessageDto): Promise<string> {
  return new Promise((resolve, reject) => {
    socket?.timeout(5000).emit('send_message', dto, (err, ack) => {
      if (err) reject(err);
      else resolve(ack.messageId);
    });
  });
}
```

### 10.4 Pinia Store（chat.ts）

```typescript
export const useChatStore = defineStore('chat', () => {
  const conversations = ref<ConversationSummary[]>([]);
  const unreadTotal = computed(() =>
    conversations.value.reduce((sum, c) => sum + c.unreadCount, 0),
  );

  async function loadConversations(): Promise<void> { ... }
  function upsertMessage(convId: string, msg: Message): void { ... }
  function markRead(convId: string): void { ... }

  return { conversations, unreadTotal, loadConversations, upsertMessage, markRead };
});
```

### 10.5 详情页接入

现有 [detail.vue](file:///d:/neighborhood-help/frontend/src/pages/task/detail.vue) 的 `doContact` 已预留入口，改为跳转聊天页：

```typescript
async function doContact(): Promise<void> {
  if (!task.value) return;
  const me = userStore.userInfo?.id;
  const peer = isPublisher.value ? task.value.helperId : task.value.publisherId;
  if (!peer) {
    uni.showToast({ title: '对方尚未接单', icon: 'none' });
    return;
  }
  uni.navigateTo({ url: `/pages/chat/chat?peerId=${peer}&taskId=${task.value.id}` });
}
```

---

## 十一、接口清单汇总

### REST 接口（需 JWT，前缀 `/api/v1`）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/chat/conversations` | 会话列表 |
| GET | `/chat/messages/:convId` | 消息历史（游标分页） |
| POST | `/chat/upload` | 上传图片/语音 |
| PUT | `/chat/read/:convId` | 标记会话已读 |

### WebSocket 事件（namespace `/chat`）

| 方向 | 事件 | 说明 |
|------|------|------|
| C→S | `send_message` | 发送消息 |
| C→S | `mark_read` | 标记已读 |
| S→C | `new_message` | 实时新消息 |
| S→C | `offline_messages` | 离线消息批量推送 |
| S→C | `message_read` | 已读回执通知 |
| S→C | `kicked` | 多端互斥踢下线 |

---

## 十二、环境变量新增

```env
# MongoDB
MONGO_URL=mongodb://localhost:27017/neighborhood_help

# WebSocket（前端用）
VITE_WS_URL=ws://localhost:3000/chat
```

---

## 十三、验收标准对照

| 验收项 | 实现方案 | 状态 |
|--------|---------|------|
| WebSocket 连接成功（JWT 验证） | ChatGateway.handleConnection 握手验签 + 黑名单 | 待实现 |
| 心跳 30s 正常保活 | Socket.IO pingInterval: 30000 | 待实现 |
| 断线 90s 自动断开 | Socket.IO pingTimeout: 90000 | 待实现 |
| 消息发送/接收实时（< 200ms） | 在线直推（内存路由，无 DB 读） | 待实现 |
| 已读回执生效 | 在线即读 + mark_read 事件 + readAt 字段 | 待实现 |
| 离线消息登录后推送 | Redis List + pushOfflineMessages | 待实现 |
| 敏感词替换为 *** | SensitiveService.filter() | 待实现 |
| 消息持久化到 MongoDB | Mongoose Message Schema + TTL 索引 | 待实现 |
| 图片/语音上传到 COS | 复用 UploadModule + /chat/upload | 待实现 |
| 断线指数退避重连 | 前端 socket.ts 1s→2s→4s→8s→16s | 待实现 |

---

## 十四、实施计划

### 阶段一：BFF 核心服务（建议先做）

1. 安装依赖：`@nestjs/websockets @nestjs/platform-socket.io socket.io mongoose @nestjs/mongoose`
2. MongoDB 接入 + Message Schema + 索引
3. ChatGateway：握手鉴权 + 连接管理 + 消息路由
4. SensitiveService 扩展 `filter()` 方法
5. ChatService：持久化 + 离线队列 + 已读标记
6. ChatController：4 个 REST 接口

### 阶段二：前端 Socket 客户端

1. 安装 `weapp.socket.io`
2. 封装 `utils/socket.ts`（单例 + 重连 + 事件分发）
3. Pinia `store/chat.ts`（会话列表 + 未读数）
4. `api/chat.ts`（REST 封装）

### 阶段三：前端页面

1. `pages/chat/list.vue` 会话列表
2. `pages/chat/chat.vue` 聊天室（消息流 + 输入栏 + 图片/语音）
3. `pages.json` 注册路由
4. detail.vue `doContact` 接入跳转

### 阶段四：联调与验收

1. 开发者工具 WebSocket 调试
2. 双端消息收发验证
3. 离线消息推送验证
4. 敏感词过滤验证
5. 多端互斥验证

---

## 十五、风险与降级

| 风险 | 影响 | 降级方案 |
|------|------|---------|
| Redis 不可用 | 离线推送失效 | 前端 REST 拉取未读消息（readAt=null） |
| MongoDB 不可用 | 消息无法持久化 | 拒绝发送 + 前端提示「消息服务暂时不可用」 |
| weapp.socket.io 版本冲突 | 前端无法连接 | 降级到原生 wx.connectSocket + 自定义 JSON 协议 |
| 微信开发者工具不支持 WS | 无法本地调试 | 真机预览调试 + Postman 模拟 WS |

---

## 十六、与现有架构的复用关系

| 现有模块 | 复用方式 |
|---------|---------|
| [JwtService](file:///d:/neighborhood-help/bff/src/auth/auth.module.ts) | Gateway 握手验签 |
| [TokenBlacklistService](file:///d:/neighborhood-help/bff/src/common/token-blacklist.service.ts) | 握手时检查黑名单 |
| [SensitiveService](file:///d:/neighborhood-help/bff/src/common/sensitive.service.ts) | 消息文本过滤（新增 filter 方法） |
| [RedisService](file:///d:/neighborhood-help/bff/src/common/redis.service.ts) | 在线状态 + 离线队列（含降级） |
| [UploadModule](file:///d:/neighborhood-help/bff/src/modules/upload/upload.module.ts) | 图片/语音上传复用 |
| [request.ts getAccessToken](file:///d:/neighborhood-help/frontend/src/utils/request.ts) | WS 握手传 token |
| [useUserStore](file:///d:/neighborhood-help/frontend/src/store/user.ts) | 获取当前用户 ID |
