import { request } from '@/utils/request';
import type { ConversationSummary, MessageListResult } from '@/types/chat';
import type { UploadResult } from '@/types';

export const chatApi = {
  /** 会话列表（含最后一条消息 + 未读数） */
  getConversations(): Promise<ConversationSummary[]> {
    return request<ConversationSummary[]>({ url: '/chat/conversations' });
  },

  /** 消息历史（游标分页） */
  getMessages(
    convId: string,
    params?: { before?: string; limit?: number },
  ): Promise<MessageListResult> {
    const query: string[] = [];
    if (params?.before) query.push(`before=${encodeURIComponent(params.before)}`);
    if (params?.limit) query.push(`limit=${params.limit}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    return request<MessageListResult>({ url: `/chat/messages/${convId}${qs}` });
  },

  /** 上传聊天图片 */
  upload(filePath: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const token = uni.getStorageSync('nh_access_token') as string;
      uni.uploadFile({
        url: `${import.meta.env.VITE_API_BASE_URL}/chat/upload`,
        filePath,
        name: 'file',
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          try {
            const body = JSON.parse(res.data) as { code: number; data: UploadResult; message: string };
            if (body.code === 0) {
              resolve(body.data);
            } else {
              reject(new Error(body.message || '上传失败'));
            }
          } catch {
            reject(new Error('上传响应解析失败'));
          }
        },
        fail: (err) => reject(new Error(err.errMsg || '上传失败')),
      });
    });
  },

  /** 标记会话已读 */
  markRead(convId: string): Promise<{ modified: number }> {
    return request<{ modified: number }>({
      url: `/chat/read/${convId}`,
      method: 'PUT',
    });
  },
};
