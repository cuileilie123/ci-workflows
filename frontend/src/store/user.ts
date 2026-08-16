import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api/auth';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '@/utils/request';
import type { User, WxUserInfo } from '@/types';

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<User | null>(null);
  const loggedIn = ref(false);

  const isLoggedIn = computed(() => loggedIn.value && !!getAccessToken());
  const nickname = computed(() => userInfo.value?.nickname ?? '');
  const avatar = computed(() => userInfo.value?.avatar ?? '');

  /** 仅清理本地态（不调用登出接口），供强制登出监听器使用 */
  function clearLocal(): void {
    clearTokens();
    userInfo.value = null;
    loggedIn.value = false;
  }

  /** 微信登录 */
  async function login(code: string, wxUserInfo?: WxUserInfo): Promise<User> {
    const res = await authApi.wxLogin(code, wxUserInfo);
    setTokens(res.accessToken, res.refreshToken);
    userInfo.value = res.user;
    loggedIn.value = true;
    return res.user;
  }

  /** 登出：先通知服务端入黑名单，再清理本地 */
  async function logout(): Promise<void> {
    const refreshToken = getRefreshToken();
    try {
      if (getAccessToken()) await authApi.logout(refreshToken);
    } catch {
      // 登出接口失败不阻塞本地清理
    } finally {
      clearLocal();
    }
  }

  /** 拉取最新用户信息 */
  async function fetchMe(): Promise<void> {
    const u = await authApi.me();
    userInfo.value = u;
    loggedIn.value = true;
  }

  /** 启动时恢复登录态：有 token 则校验 /auth/me（401 自动刷新） */
  async function restore(): Promise<void> {
    const access = getAccessToken();
    if (!access) {
      clearLocal();
      return;
    }
    try {
      await fetchMe();
    } catch {
      // me 失败（含自动刷新也失败）→ 视为未登录
      clearLocal();
    }
  }

  /** Mock 登录（开发环境专用） */
  function setMockLoginState(token: string, refreshToken: string, user: User): void {
    setTokens(token, refreshToken);
    userInfo.value = user;
    loggedIn.value = true;
  }

  return {
    userInfo,
    loggedIn,
    isLoggedIn,
    nickname,
    avatar,
    clearLocal,
    login,
    logout,
    fetchMe,
    restore,
    setMockLoginState,
  };
});
