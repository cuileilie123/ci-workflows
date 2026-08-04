/** 消息类型 */
export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VOICE = 'VOICE',
  LOCATION = 'LOCATION',
  SYSTEM = 'SYSTEM',
}

/** 消息附加数据（非文本消息的载荷） */
export interface MessageMetadata {
  url?: string; // IMAGE / VOICE 的资源链接
  duration?: number; // VOICE 时长（秒）
  lat?: number; // LOCATION 纬度
  lng?: number; // LOCATION 经度
  address?: string; // LOCATION 地址
}

/** 消息文档（与 MongoDB Schema 对齐） */
export interface MessageDocument {
  _id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  type: MessageType;
  content: string;
  metadata: MessageMetadata | null;
  readAt: Date | null;
  clientMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 会话摘要（聚合查询结果） */
export interface ConversationSummary {
  conversationId: string;
  peerId: string;
  peerNickname: string;
  peerAvatar: string | null;
  lastMessage: MessageDocument | null;
  unreadCount: number;
}

/** 消息历史分页结果 */
export interface MessageListResult {
  list: MessageDocument[];
  hasMore: boolean;
}

/** 发送消息 ack 响应 */
export interface SendMessageAck {
  status: 'ok';
  messageId: string;
}
