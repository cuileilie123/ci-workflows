# 需求规格：认证与用户体系

## 1. 微信登录流程
- 小程序调用 `wx.login()` 获取 `code`（有效期 5 分钟）
- 前端 POST `/api/v1/auth/wx-login` 携带 `{ code, userInfo }`
- BFF 调用微信 `code2Session` 换取 `openid` + `session_key`
- 首次登录自动注册，生成内部 `user_id`
- 返回 JWT（2h 过期）+ Refresh Token（7d 过期）

## 2. 用户信息
- 昵称、头像（微信授权获取）
- 手机号（单独授权，`getPhoneNumber` 解密）
- 信用分（初始 100，范围 0-200）
- 角色：USER / HELPER / ADMIN

## 3. Token 刷新机制
- Access Token 过期 → 前端用 Refresh Token 调 `/auth/refresh`
- Refresh Token 也过期 → 强制重新登录
- 服务端维护 Token 黑名单（Redis Set）

## 4. 安全要求
- `session_key` 不落库，仅内存使用
- 手机号 AES-256 加密存储
- 登录 IP 异常检测（异地登录告警）
- 同一设备最多 3 个账号登录

## 5. 对应需求条目
#3, #4, #27, #28, #29, #30, #52, #91, #92, #93, #94
