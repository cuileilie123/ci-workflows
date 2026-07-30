---
name: wx-login-gateway
description: 实现微信登录 BFF 端（code2Session + JWT签发）
model: claude-4-sonnet
tags: [bff, auth]
depends_on: [nestjs-init]
---

# 任务：实现微信登录 BFF 接口

## 目标
完成微信小程序登录的后端逻辑：code 换 openid → 注册/登录 → 签发 JWT。

## 具体步骤

### 1. 创建 `src/modules/auth/auth.controller.ts`

**接口清单：**
| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/auth/wx-login` | 微信登录（code + userInfo） |
| POST | `/api/v1/auth/refresh` | 刷新 Token |
| POST | `/api/v1/auth/logout` | 退出登录 |
| GET  | `/api/v1/auth/me` | 获取当前用户信息 |

### 2. 微信 code2Session 服务
```typescript
// wx.service.ts
@Injectable()
export class WxService {
  async code2Session(code: string): Promise<{ openid: string; sessionKey: string }> {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`;
    // 重试 3 次，指数退避
    // 成功返回 { openid, session_key }
    // 失败抛 WxApiException
  }
}
```

### 3. 登录流程 `auth.service.ts`
```typescript
async wxLogin(dto: WxLoginDto): Promise<LoginResult> {
  // 1. code2Session 获取 openid
  const { openid } = await this.wxService.code2Session(dto.code);
  
  // 2. 查找或创建用户
  let user = await this.prisma.user.findUnique({ where: { openid } });
  if (!user) {
    user = await this.prisma.user.create({
      data: { openid, nickname: dto.nickname, avatar: dto.avatar }
    });
  } else {
    // 更新昵称头像（用户可能修改了）
    user = await this.prisma.user.update({
      where: { id: user.id },
      data: { nickname: dto.nickname, avatar: dto.avatar }
    });
  }
  
  // 3. 签发 JWT
  const accessToken = this.jwtService.sign(
    { sub: user.id, role: user.role },
    { expiresIn: '2h' }
  );
  const refreshToken = this.jwtService.sign(
    { sub: user.id, type: 'refresh' },
    { expiresIn: '7d' }
  );
  
  // 4. 存储 Refresh Token 到 Redis（用于黑名单）
  await this.redis.set(`refresh:${user.id}`, refreshToken, 'EX', 604800);
  
  return { accessToken, refreshToken, expiresIn: 7200, userInfo: user };
}
```

### 4. Refresh Token 逻辑
- 验证 Refresh Token 签名
- 检查 Redis 中是否存在（防止复用/登出后使用）
- 签发新的 Access Token + 新的 Refresh Token（Token Rotation）
- 旧的 Refresh Token 加入黑名单（Redis Set，TTL=7d）

### 5. 登出逻辑
- 从 Redis 删除 Refresh Token
- Access Token 加入黑名单（Redis Set，TTL=剩余有效期）
- JwtAuthGuard 校验时检查黑名单

### 6. 敏感内容检测
- 登录前检测昵称：`security.msgSecCheck`
- 命中敏感词 → 拒绝登录 + 提示用户修改昵称

## 验收标准
- [ ] 首次登录自动注册
- [ ] 二次登录更新昵称头像
- [ ] JWT 签发正确（含 role）
- [ ] Refresh Token 轮换生效
- [ ] 登出后 Token 立即失效
- [ ] 敏感昵称被拦截

## 参考文件
- `specs/01-auth.md` → 微信登录流程 + 安全要求
- `.trae/memory.md` → 已知坑（code2Session 40163）
