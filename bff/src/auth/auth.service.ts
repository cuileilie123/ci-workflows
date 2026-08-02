import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WxService } from './wx.service';
import { SensitiveService } from './sensitive.service';
import { TokenBlacklistService } from '../common/token-blacklist.service';
import type { RefreshDto, WxLoginDto } from './dto/wx-login.dto';

const ACCESS_TTL_SEC = 2 * 60 * 60; // 2h
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60; // 7d

export interface UserInfoPayload {
  id: string;
  openid: string;
  nickname: string;
  avatar: string | null;
  phone: string | null;
  creditScore: number;
  role: string;
  status: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserInfoPayload;
}

interface AccessJwtPayload {
  sub: string;
  role: string;
  type: string;
}

interface RefreshJwtPayload {
  sub: string;
  type: string;
  exp?: number;
}

@Injectable()
export class AuthService {
  private readonly refreshSecret: string;

  constructor(
    private readonly wx: WxService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sensitive: SensitiveService,
    private readonly blacklist: TokenBlacklistService,
  ) {
    // Refresh Token 使用独立密钥；未配置时回退到 JWT_SECRET
    this.refreshSecret =
      this.config.get<string>('JWT_REFRESH_SECRET') ||
      this.config.get<string>('JWT_SECRET') ||
      'nh_dev_jwt_secret_2026_change_in_production';
  }

  /** 微信登录：code → openid → 注册/更新 → 签发 Token */
  async wxLogin(dto: WxLoginDto): Promise<LoginResult> {
    // 1. code 换 openid（session_key 仅内存使用，不落库）
    const { openid } = await this.wx.code2Session(dto.code);

    // 2. 昵称处理 + 敏感词检测
    const rawNick = (dto.userInfo?.nickname ?? '').toString().trim();
    const nickname = rawNick || `用户${openid.slice(-6)}`;
    if (this.sensitive.isSensitive(nickname)) {
      throw new BadRequestException('昵称含敏感词，请修改后重试');
    }
    const avatar = dto.userInfo?.avatarUrl ?? null;

    // 3. 查找或创建用户；老用户更新昵称头像
    let user = await this.prisma.user.findUnique({ where: { openid } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { openid, nickname, avatar },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { nickname, avatar: avatar ?? user.avatar },
      });
    }

    return this.issueTokens(user);
  }

  /** 刷新 Token：校验 → 旋转（旧 refresh 入黑名单）→ 重发 */
  async refresh(dto: RefreshDto): Promise<LoginResult> {
    let payload: RefreshJwtPayload;
    try {
      payload = this.jwt.verify(dto.refreshToken, {
        secret: this.refreshSecret,
      }) as RefreshJwtPayload;
    } catch {
      throw new UnauthorizedException('Refresh Token 无效或已过期');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token 类型错误');
    }
    if (this.blacklist.isBlacklisted(dto.refreshToken)) {
      throw new UnauthorizedException('Refresh Token 已失效，请重新登录');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(payload.sub) },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户不存在或已禁用');
    }

    // Token Rotation：旧 refresh 立即失效
    this.blacklist.blacklist(dto.refreshToken, REFRESH_TTL_SEC);
    return this.issueTokens(user);
  }

  /** 登出：access + refresh 全部入黑名单 */
  async logout(accessToken: string, refreshToken?: string): Promise<void> {
    try {
      const decoded = this.jwt.decode(accessToken) as RefreshJwtPayload | null;
      const exp = decoded?.exp ?? 0;
      const ttl = Math.max(0, exp - Math.floor(Date.now() / 1000));
      if (ttl > 0) this.blacklist.blacklist(accessToken, ttl);
    } catch {
      // access token 无法解析则忽略
    }
    if (refreshToken) {
      this.blacklist.blacklist(refreshToken, REFRESH_TTL_SEC);
    }
  }

  /** 获取当前登录用户信息 */
  async me(userId: string): Promise<UserInfoPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });
    if (!user) throw new NotFoundException('用户不存在');
    return this.toUserInfo(user);
  }

  private async issueTokens(user: {
    id: bigint;
    openid: string;
    nickname: string;
    avatar: string | null;
    phone: string | null;
    creditScore: number;
    role: string;
    status: string;
  }): Promise<LoginResult> {
    const payload: AccessJwtPayload = {
      sub: user.id.toString(),
      role: user.role,
      type: 'access',
    };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: ACCESS_TTL_SEC,
    });
    const refreshToken = this.jwt.sign(
      { sub: user.id.toString(), type: 'refresh' },
      { secret: this.refreshSecret, expiresIn: REFRESH_TTL_SEC },
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SEC,
      user: this.toUserInfo(user),
    };
  }

  private toUserInfo(u: {
    id: bigint;
    openid: string;
    nickname: string;
    avatar: string | null;
    phone: string | null;
    creditScore: number;
    role: string;
    status: string;
  }): UserInfoPayload {
    return {
      id: u.id.toString(),
      openid: u.openid,
      nickname: u.nickname,
      avatar: u.avatar,
      phone: u.phone,
      creditScore: u.creditScore,
      role: u.role,
      status: u.status,
    };
  }
}
