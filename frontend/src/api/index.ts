import { request } from '@/utils/request';
import type { User } from '@/types';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export const authApi = {
  /** 微信登录 */
  wxLogin: (code: string, userInfo: Record<string, unknown>): Promise<LoginResponse> =>
    request<LoginResponse>({
      url: '/auth/wx-login',
      method: 'POST',
      data: { code, userInfo },
    }),

  /** 刷新 Token */
  refresh: (refreshToken: string): Promise<LoginResponse> =>
    request<LoginResponse>({
      url: '/auth/refresh',
      method: 'POST',
      data: { refreshToken },
    }),
};
