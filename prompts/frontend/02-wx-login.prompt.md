---
name: wx-login
description: 实现微信小程序登录 + JWT 存储
model: claude-4-sonnet
tags: [frontend, auth]
depends_on: [init-miniprogram]
---

# 任务：实现微信登录全流程

## 目标
完成小程序端微信登录，获取 JWT 并安全存储。

## 具体步骤

### 1. 创建 `src/utils/request.ts`
- 封装 `wx.request` 为 Promise
- 请求拦截器：自动注入 `Authorization: Bearer {token}`
- 响应拦截器：401 → 调 refresh → 重试原请求（最多 1 次）
- 统一错误处理：网络错误 Toast，业务错误 Toast 提示

### 2. 创建 `src/api/auth.ts`
```typescript
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userInfo: UserInfo;
}

export function wxLogin(code: string, userInfo: WxUserInfo): Promise<LoginResponse>;
export function refreshToken(refreshToken: string): Promise<LoginResponse>;
export function logout(): Promise<void>;
```

### 3. 创建 `src/store/user.ts` (Pinia)
- State: `token`, `refreshToken`, `userInfo`, `isLoggedIn`
- Actions: `login()`, `logout()`, `refreshAccessToken()`
- Token 存储：使用 `wx.setStorageSync` 加密存储
- 初始化时自动检查 token 有效性

### 4. 创建登录页 `src/pages/auth/login.vue`
- 按钮：`open-type="chooseAvatar"` 获取头像
- 按钮：`@click="onGetUserProfile"` 获取昵称
- 调用 `wx.login()` → 获取 code → POST `/api/v1/auth/wx-login`
- 登录成功 → 跳转首页
- 登录失败 → Toast 提示 + 重试按钮

### 5. Token 刷新机制
- 响应拦截器捕获 401
- 用 refreshToken 调 `/api/v1/auth/refresh`
- 成功 → 更新 store + 重试原请求
- 失败 → 清除 store → 跳登录页

## 验收标准
- [ ] 首次进入弹出授权页
- [ ] 授权后获取用户信息并存储
- [ ] Token 过期自动刷新
- [ ] Refresh Token 过期强制重新登录
- [ ] 所有 API 请求自动带 Token

## 参考文件
- `specs/01-auth.md` → 微信登录流程
- `.trae/memory.md` → 禁止事项 #9
