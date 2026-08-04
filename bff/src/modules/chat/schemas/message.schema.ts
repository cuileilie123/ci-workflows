import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { MessageType } from '../types/message.type';

/**
 * 聊天消息 Schema
 * - conversationId: `${min(uid)}_${max(uid)}` 确定性生成
 * - TTL: 普通消息保留 1 年，系统消息永久（partialFilterExpression）
 */
@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  // Mongoose 自动生成的 _id
  _id!: string;

  @Prop({ required: true, index: true })
  conversationId!: string;

  @Prop({ required: true, index: true })
  senderId!: string;

  @Prop({ required: true })
  receiverId!: string;

  @Prop({ enum: MessageType, default: MessageType.TEXT })
  type!: MessageType;

  @Prop({ default: '' })
  content!: string;

  @Prop({ type: Object, default: null })
  metadata!: {
    url?: string;
    duration?: number;
    lat?: number;
    lng?: number;
    address?: string;
  } | null;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  @Prop({ type: String, default: null })
  clientMessageId!: string | null;

  // timestamps: true 自动生成
  createdAt!: Date;
  updatedAt!: Date;
}

export type MessageHydratedDocument = HydratedDocument<Message>;
export const MessageSchema = SchemaFactory.createForClass(Message);

// 复合索引：按会话查历史消息（倒序）
MessageSchema.index({ conversationId: 1, createdAt: -1 });

// TTL 索引：普通消息 1 年自动过期，系统消息永久
MessageSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 31536000, // 365 天
    partialFilterExpression: { type: { $ne: MessageType.SYSTEM } },
  },
);

// 幂等键索引：防重复消息
MessageSchema.index(
  { clientMessageId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { clientMessageId: { $ne: null } },
  },
);
