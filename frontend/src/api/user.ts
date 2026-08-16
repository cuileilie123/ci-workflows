import { request } from '@/utils/request';

/** 用户资料 */
export interface UserProfile {
  id: string;
  nickname: string;
  avatar: string | null;
  phone: string | null;
  gender: 'MALE' | 'FEMALE' | 'UNKNOWN' | null;
  bio: string | null;
  createdAt: string;
}

/** 用户设置 */
export interface UserSettings {
  notifyEnabled: boolean;
  soundEnabled: boolean;
  lang: string;
}

/** 更新资料 DTO */
export interface UpdateProfilePayload {
  nickname?: string;
  avatar?: string;
  phone?: string;
  gender?: 'MALE' | 'FEMALE' | 'UNKNOWN';
  bio?: string;
}

export const userApi = {
  /** 获取当前用户资料 */
  getProfile(): Promise<UserProfile> {
    return request<UserProfile>({
      url: '/user/profile',
    });
  },

  /** 更新当前用户资料 */
  updateProfile(payload: UpdateProfilePayload): Promise<UserProfile> {
    return request<UserProfile>({
      url: '/user/profile',
      method: 'PUT',
      data: payload as unknown as Record<string, unknown>,
    });
  },

  /** 获取用户设置 */
  getSettings(): Promise<UserSettings> {
    return request<UserSettings>({
      url: '/user/settings',
    });
  },

  /** 修改手机号 */
  changePhone(newPhone: string, code?: string): Promise<{ success: boolean }> {
    const data: Record<string, unknown> = { phone: newPhone };
    if (code) data.code = code;
    return request<{ success: boolean }>({
      url: '/user/phone',
      method: 'PUT',
      data,
    });
  },

  /** 修改密码 */
  changePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>({
      url: '/user/password',
      method: 'PUT',
      data: { oldPassword, newPassword } as unknown as Record<string, unknown>,
    });
  },

  /** 注销账号 */
  deleteAccount(reason?: string): Promise<{ success: boolean }> {
    const data: Record<string, unknown> = {};
    if (reason) data.reason = reason;
    return request<{ success: boolean }>({
      url: '/user/account',
      method: 'DELETE',
      data,
    });
  },

  /** 提交意见反馈 */
  submitFeedback(content: string, images?: string[]): Promise<{ success: boolean; ticketId?: string }> {
    const data: Record<string, unknown> = { content };
    if (images && images.length) data.images = images;
    return request<{ success: boolean; ticketId?: string }>({
      url: '/user/feedback',
      method: 'POST',
      data,
    });
  },
};
