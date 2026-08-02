import { request } from '@/utils/request';
import type { LoginResponse, User, WxUserInfo } from '@/types';

export const authApi = {
  /** 微信登录：code + 可选用户信息 → JWT + Refresh Token */
  wxLogin(code: string, userInfo?: WxUserInfo): Promise<LoginResponse> {
    return request<LoginResponse>({
      url: '/auth/wx-login',
      method: 'POST',
      data: { code, userInfo },
    });
  },

  /** 刷新 Token（通常由 request 拦截器自动调用，也可主动调用） */
  refresh(refreshToken: string): Promise<LoginResponse> {
    return request<LoginResponse>({
      url: '/auth/refresh',
      method: 'POST',
      data: { refreshToken },
      _skipAuthRefresh: true,
    });
  },

  /** 登出：服务端将 access + refresh 加入黑名单 */
  logout(refreshToken: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>({
      url: '/auth/logout',
      method: 'POST',
      data: { refreshToken },
    });
  },

  /** 获取当前登录用户信息 */
  me(): Promise<User> {
    return request<User>({ url: '/auth/me', method: 'GET' });
  },
};
