const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: Record<string, unknown>;
  header?: Record<string, string>;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export function getToken(): string {
  return uni.getStorageSync('token') as string;
}

export function setToken(token: string): void {
  uni.setStorageSync('token', token);
}

export function clearToken(): void {
  uni.removeStorageSync('token');
}

export function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, header = {} } = options;
  const token = getToken();

  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      success: (res) => {
        const body = res.data as ApiResponse<T>;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body.data);
        } else if (res.statusCode === 401) {
          clearToken();
          uni.navigateTo({ url: '/pages/login/login' });
          reject(new Error('登录已过期'));
        } else {
          uni.showToast({ title: body.message || '请求失败', icon: 'none' });
          reject(new Error(body.message || '请求失败'));
        }
      },
      fail: (err) => {
        uni.showToast({ title: '网络错误', icon: 'none' });
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}
