import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { TokenBlacklistService } from '../../common/token-blacklist.service';
import { SensitiveService } from '../../common/sensitive.service';
import { RedisService } from '../../common/redis.service';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageType } from './types/message.type';
import { parseCorsOrigins } from '../../main';

/**
 * 聊天 WebSocket 网关
 * - 握手验签 + 黑名单（复用 JwtService / TokenBlacklistService）
 * - 多端互斥（新连接踢旧连接）
 * - 在线直推 / 离线入队
 * - 敏感词过滤（复用 SensitiveService.filter）
 *
 * CORS 白名单与 main.ts 保持一致（小程序 + 本地开发 + H5 正式域），
 * 允许通过 CORS_ORIGINS 环境变量追加。
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGINS),
    credentials: true,
    methods: ['GET', 'POST'],
  },
  pingInterval: 30000, // 30s 心跳
  pingTimeout: 90000, // 90s 超时断开
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  // userId → socketId 映射（内存态，断线即清）
  private readonly clients = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly blacklist: TokenBlacklistService,
    private readonly sensitive: SensitiveService,
    private readonly redis: RedisService,
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.emit('connect_error', { message: '缺少认证令牌' });
      client.disconnect();
      return;
    }

    // 验证 JWT 签名
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(token) as { sub: string };
    } catch {
      client.emit('connect_error', { message: 'Token 无效或已过期' });
      client.disconnect();
      return;
    }

    // 检查黑名单
    if (this.blacklist.isBlacklisted(token)) {
      client.emit('connect_error', { message: 'Token 已失效' });
      client.disconnect();
      return;
    }

    const userId = payload.sub;
    client.data.userId = userId;

    // 多端互斥：踢掉旧连接
    const oldSocketId = this.clients.get(userId);
    if (oldSocketId && oldSocketId !== client.id) {
      const oldSocket = this.server.sockets.sockets.get(oldSocketId);
      oldSocket?.emit('kicked', { reason: '另一设备登录' });
      oldSocket?.disconnect(true);
    }

    // 注册连接
    this.clients.set(userId, client.id);
    await this.redis.set(`online:${userId}`, client.id, 120);
    this.logger.log(`用户 ${userId} 已连接 (socket=${client.id})`);

    // 推送离线消息
    await this.pushOfflineMessages(userId, client);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;

    // 仅当 socketId 匹配时才清除（避免被踢后误清新连接）
    if (this.clients.get(userId) === client.id) {
      this.clients.delete(userId);
      await this.redis.del(`online:${userId}`);
      this.logger.log(`用户 ${userId} 已断开`);
    }
  }

  /** 发送消息 */
  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody() dto: SendMessageDto,
    @ConnectedSocket() client: Socket,
  ): Promise<{ status: 'ok'; messageId: string }> {
    const senderId = client.data.userId as string;
    if (!senderId) {
      return { status: 'ok', messageId: '' };
    }

    // 敏感词过滤（仅文本）
    const content =
      dto.type === MessageType.TEXT ? this.sensitive.filter(dto.content) : dto.content;

    const conversationId = ChatService.buildConversationId(senderId, dto.receiverId);

    // 持久化
    const message = await this.chatService.createMessage({
      conversationId,
      senderId,
      receiverId: dto.receiverId,
      type: dto.type,
      content,
      metadata: dto.metadata ?? null,
      clientMessageId: dto.clientMessageId,
    });

    // 路由到接收方
    const receiverSocketId = this.clients.get(dto.receiverId);
    if (receiverSocketId) {
      // 在线 → 实时推送
      // 已读标记由接收方前端收到消息后主动调用 mark_read 事件触发，
      // 避免每条在线消息都同步执行 MongoDB updateOne 造成高并发下处理积压
      this.server.to(receiverSocketId).emit('new_message', message);
    } else {
      // 离线 → 入队
      await this.chatService.pushOffline(dto.receiverId, message);
    }

    return { status: 'ok', messageId: String(message._id) };
  }

  /** 标记会话已读 */
  @SubscribeMessage('mark_read')
  async onMarkRead(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ modified: number }> {
    const userId = client.data.userId as string;
    if (!userId) return { modified: 0 };

    const modified = await this.chatService.markConversationRead(data.conversationId, userId);

    // 通知对方：消息已读
    const [a, b] = data.conversationId.split('_');
    const peerId = a === userId ? b : a;
    const peerSocketId = this.clients.get(peerId);
    if (peerSocketId) {
      this.server.to(peerSocketId).emit('message_read', {
        conversationId: data.conversationId,
      });
    }

    return { modified };
  }

  /** 推送离线消息 */
  private async pushOfflineMessages(userId: string, client: Socket): Promise<void> {
    const messages = await this.chatService.popOffline(userId);
    if (!messages.length) return;
    client.emit('offline_messages', messages);
    this.logger.log(`推送 ${messages.length} 条离线消息给用户 ${userId}`);
  }
}
