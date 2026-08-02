# Task 002: 微信登录全链路

- **Prompts**:
  - `prompts/frontend/01-init-miniprogram.prompt.md`
  - `prompts/frontend/02-wx-login.prompt.md`
  - `prompts/bff/02-wx-login-gateway.prompt.md`
- **执行顺序**: 2
- **状态**: done
- **依赖**: Task 001
- **预估时间**: 2 小时
- **说明**: 打通小程序 → BFF → 微信API → JWT 的完整登录闭环
- **验收**:
  - [x] 小程序能拉起授权页
  - [x] 授权后获取 openid + 用户信息
  - [x] BFF 签发 JWT + Refresh Token
  - [x] Token 过期自动刷新
  - [x] Refresh Token 过期强制重新登录
  - [x] 敏感昵称被拦截
  - [x] Swagger 文档有 /auth/wx-login 接口
