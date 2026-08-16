import type { ApiResponse } from '@/types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

const ACCESS_TOKEN_KEY = 'nh_access_token';
const REFRESH_TOKEN_KEY = 'nh_refresh_token';

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown>;
  header?: Record<string, string>;
  /** 内部标记：跳过 401 自动刷新（refresh 接口自身使用，防止递归） */
  _skipAuthRefresh?: boolean;
  /** 内部标记：静默模式，失败时不弹 toast（埋点等非关键请求使用） */
  _silent?: boolean;
}

// ---- Token 存储 ----
export function getAccessToken(): string {
  return (uni.getStorageSync(ACCESS_TOKEN_KEY) as string) || '';
}

export function getRefreshToken(): string {
  return (uni.getStorageSync(REFRESH_TOKEN_KEY) as string) || '';
}

export function setTokens(accessToken: string, refreshToken: string): void {
  uni.setStorageSync(ACCESS_TOKEN_KEY, accessToken);
  uni.setStorageSync(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  uni.removeStorageSync(ACCESS_TOKEN_KEY);
  uni.removeStorageSync(REFRESH_TOKEN_KEY);
}

/** 强制登出：清 token + 通知全局监听器跳登录页 */
export function forceLogout(): void {
  clearTokens();
  uni.$emit('auth:expired');
}

// ---- 401 自动刷新（带并发锁，最多重试 1 次）----
let refreshing: Promise<string | null> | null = null;

interface RefreshData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function rawRequest<T>(url: string, method: string, data?: Record<string, unknown>): Promise<ApiResponse<T>> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}${url}`,
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      data,
      header: { 'Content-Type': 'application/json' },
      success: (res) => resolve(res.data as ApiResponse<T>),
      fail: (err) => reject(new Error(err.errMsg || '网络错误')),
    });
  });
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const body = await rawRequest<RefreshData>('/auth/refresh', 'POST', { refreshToken });
    if (body.code === 0 && body.data?.accessToken) {
      setTokens(body.data.accessToken, body.data.refreshToken);
      return body.data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

/** 多个并发请求 401 时，共用同一次刷新 */
function refreshOnce(): Promise<string | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function send<T>(options: RequestOptions, token: string): Promise<ApiResponse<T>> {
  const fullUrl = `${BASE_URL}${options.url}`;
  return new Promise((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method: options.method ?? 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header ?? {}),
      },
      success: (res) => resolve(res.data as ApiResponse<T>),
      fail: (err) => reject(new Error(err.errMsg || '网络错误')),
    });
  });
}

export function request<T>(options: RequestOptions): Promise<T> {
  const token = getAccessToken();

  return new Promise<T>((resolve, reject) => {
    send<T>(options, token)
      .then(async (body) => {
        // 业务成功（code === 0）
        if (body.code === 0) {
          resolve(body.data);
          return;
        }

        // 401：尝试刷新一次后重试
        if (body.code === 401 && !options._skipAuthRefresh) {
          const newToken = await refreshOnce();
          if (newToken) {
            try {
              const retryBody = await send<T>(options, newToken);
              if (retryBody.code === 0) {
                resolve(retryBody.data);
                return;
              }
              reject(new Error(retryBody.message || '请求失败'));
              return;
            } catch (e) {
              reject(e as Error);
              return;
            }
          }
          // 刷新失败 → 强制登出
          forceLogout();
          reject(new Error('登录已过期，请重新登录'));
          return;
        }

        // 其他业务错误
        const msg = body.message || '请求失败';
        if (!options._silent) {
          uni.showToast({ title: msg, icon: 'none' });
        }
        reject(new Error(msg));
      })
      .catch((err: Error) => {
        if (!options._silent) {
          uni.showToast({ title: err.message || '网络错误', icon: 'none' });
        }
        reject(err);
      });
  });
}

/** 防抖函数 */
export function debounce<T extends (...args: never[]) => unknown>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (this: unknown, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

/** HTTP 快捷方法 */
export const http = {
  get<T>(url: string, params?: Record<string, unknown>) {
    return request<T>({ url, method: 'GET', data: params });
  },
  post<T>(url: string, data?: Record<string, unknown>) {
    return request<T>({ url, method: 'POST', data });
  },
  put<T>(url: string, data?: Record<string, unknown>) {
    return request<T>({ url, method: 'PUT', data });
  },
  delete<T>(url: string, data?: Record<string, unknown>) {
    return request<T>({ url, method: 'DELETE', data });
  },
};
