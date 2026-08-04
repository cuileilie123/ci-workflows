/** 消息类型（与 BFF MessageType 枚举对齐） */
export type MessageType = 'TEXT' | 'IMAGE' | 'VOICE' | 'LOCATION' | 'SYSTEM';

/** 消息附加数据 */
export interface MessageMetadata {
  url?: string;
  duration?: number;
  lat?: number;
  lng?: number;
  address?: string;
}

/** 聊天消息（与 BFF Message Schema 对齐） */
export interface ChatMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  type: MessageType;
  content: string;
  metadata: MessageMetadata | null;
  readAt: string | null;
  clientMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 会话摘要（与 BFF ConversationSummary 对齐） */
export interface ConversationSummary {
  conversationId: string;
  peerId: string;
  peerNickname: string;
  peerAvatar: string | null;
  lastMessage: ChatMessage | null;
  unreadCount: number;
}

/** 消息历史分页结果 */
export interface MessageListResult {
  list: ChatMessage[];
  hasMore: boolean;
}

/** 发送消息入参 */
export interface SendMessagePayload {
  receiverId: string;
  type: MessageType;
  content: string;
  metadata?: MessageMetadata;
  clientMessageId?: string;
}

/** 发送消息 ack */
export interface SendMessageAck {
  status: 'ok';
  messageId: string;
}

/** 已读回执通知 */
export interface MessageReadPayload {
  conversationId: string;
  messageIds?: string[];
}
