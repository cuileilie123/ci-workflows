import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis.service';
import { Message } from './schemas/message.schema';
import {
  ConversationSummary,
  MessageListResult,
  MessageMetadata,
  MessageType,
} from './types/message.type';

interface CreateMessageInput {
  conversationId: string;
  senderId: string;
  receiverId: string;
  type: MessageType;
  content: string;
  metadata: MessageMetadata | null;
  clientMessageId?: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  // 幂等缓存：避免对同一 clientMessageId 重复查 MongoDB
  private readonly idempotencyCache = new Map<string, { message: Message; expireAt: number }>();
  private readonly IDEMPOTENCY_CACHE_TTL_MS = 60_000;

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** 构建确定性会话 ID：min(uid)_max(uid) */
  static buildConversationId(uidA: string, uidB: string): string {
    const a = BigInt(uidA);
    const b = BigInt(uidB);
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  /** 创建消息（带 clientMessageId 幂等） */
  async createMessage(input: CreateMessageInput): Promise<Message> {
    // 幂等：先查内存缓存（避免高频重复请求打 MongoDB）
    if (input.clientMessageId) {
      const cached = this.idempotencyCache.get(input.clientMessageId);
      if (cached && cached.expireAt > Date.now()) {
        return cached.message;
      }
    }

    // 幂等：再查 MongoDB（已持久化的）
    if (input.clientMessageId) {
      const existing = await this.messageModel
        .findOne({ clientMessageId: input.clientMessageId })
        .lean()
        .exec();
      if (existing) {
        this.cacheIdempotency(input.clientMessageId, existing as Message);
        return existing as Message;
      }
    }

    const created = await this.messageModel.create({
      conversationId: input.conversationId,
      senderId: input.senderId,
      receiverId: input.receiverId,
      type: input.type,
      content: input.content,
      metadata: input.metadata ?? null,
      readAt: null,
      clientMessageId: input.clientMessageId ?? null,
    });

    // 写入幂等缓存
    if (input.clientMessageId) {
      this.cacheIdempotency(input.clientMessageId, created);
    }

    return created;
  }

  /** 写入幂等缓存（带 TTL 和容量清理） */
  private cacheIdempotency(clientMessageId: string, message: Message): void {
    this.idempotencyCache.set(clientMessageId, {
      message,
      expireAt: Date.now() + this.IDEMPOTENCY_CACHE_TTL_MS,
    });
    // 容量超限时清理过期项
    if (this.idempotencyCache.size > 1000) {
      const now = Date.now();
      for (const [key, val] of this.idempotencyCache) {
        if (val.expireAt <= now) this.idempotencyCache.delete(key);
      }
    }
  }

  /** 标记单条消息已读 */
  async markRead(messageId: string): Promise<void> {
    await this.messageModel.updateOne({ _id: messageId }, { $set: { readAt: new Date() } }).exec();
  }

  /** 批量标记已读 */
  async markReadBatch(messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    await this.messageModel
      .updateMany({ _id: { $in: messageIds }, readAt: null }, { $set: { readAt: new Date() } })
      .exec();
  }

  /** 标记会话中所有未读消息为已读 */
  async markConversationRead(convId: string, userId: string): Promise<number> {
    const res = await this.messageModel.updateMany(
      { conversationId: convId, receiverId: userId, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return res.modifiedCount;
  }

  /** 消息历史（游标分页） */
  async getMessages(convId: string, before?: string, limit = 20): Promise<MessageListResult> {
    const query: Record<string, unknown> = { conversationId: convId };
    if (before) query.createdAt = { $lt: new Date(before) };

    const docs = await this.messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = docs.length > limit;
    const list = (hasMore ? docs.slice(0, limit) : docs).map((d) => ({
      ...d,
      _id: String(d._id),
    })) as unknown as MessageListResult['list'];

    return { list, hasMore };
  }

  /** 会话列表（聚合查询最后一条消息 + 未读数） */
  async getConversations(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.messageModel.aggregate<{
      _id: string;
      lastMessage: Record<string, unknown>;
      unreadCount: number;
    }>([
      {
        $match: {
          $or: [{ senderId: userId }, { receiverId: userId }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$conversationId',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ['$receiverId', userId] }, { $eq: ['$readAt', null] }],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);

    if (!rows.length) return [];

    // 批量查 peer 用户信息
    const peerIds = rows.map((r) => {
      const [a, b] = r._id.split('_');
      return a === userId ? b : a;
    });
    const peers = await this.prisma.user.findMany({
      where: { id: { in: peerIds.map((id) => BigInt(id)) } },
      select: { id: true, nickname: true, avatar: true },
    });
    const peerMap = new Map(peers.map((p) => [String(p.id), p]));

    return rows.map((r) => {
      const [a, b] = r._id.split('_');
      const peerId = a === userId ? b : a;
      const peer = peerMap.get(peerId);
      return {
        conversationId: r._id,
        peerId,
        peerNickname: peer?.nickname ?? '邻居',
        peerAvatar: peer?.avatar ?? null,
        lastMessage: r.lastMessage as unknown as ConversationSummary['lastMessage'],
        unreadCount: r.unreadCount,
      };
    });
  }

  // ---- 离线消息队列（Redis List）----

  /** 离线消息入队 */
  async pushOffline(userId: string, message: unknown): Promise<void> {
    const key = `offline:${userId}`;
    await this.redis.lpush(key, JSON.stringify(message));
  }

  /** 离线消息出队（连接时拉取全部） */
  async popOffline(userId: string): Promise<Record<string, unknown>[]> {
    const key = `offline:${userId}`;
    const raw = await this.redis.lrange(key, 0, -1);
    if (!raw.length) return [];
    await this.redis.del(key);
    return raw.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}
