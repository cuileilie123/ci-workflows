import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WxService } from './wx.service';
import { SensitiveService } from '../common/sensitive.service';
import { TokenBlacklistService } from '../common/token-blacklist.service';
import { WalletService } from '../modules/wallet/wallet.service';
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
  openid?: string;
}

interface RefreshJwtPayload {
  sub: string;
  type: string;
  exp?: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshSecret: string;

  constructor(
    private readonly wx: WxService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sensitive: SensitiveService,
    private readonly blacklist: TokenBlacklistService,
    private readonly walletService: WalletService,
  ) {
    // Refresh Token 使用独立密钥；未配置时回退到 JWT_SECRET
    this.refreshSecret =
      this.config.get<string>('JWT_REFRESH_SECRET') ||
      this.config.get<string>('JWT_SECRET') ||
      'nh_dev_jwt_secret_2026_change_in_production';
  }

  /** 微信登录：code → openid → 注册/更新 → 签发 Token */
  async wxLogin(dto: WxLoginDto): Promise<LoginResult> {
    const codePreview = dto.code ? dto.code.slice(0, 8) + '...' : '(空)';
    this.logger.log(`[AUTH] [LOG-AU-001] wxLogin 入口: code=${codePreview}, userInfo.nickname=${dto.userInfo?.nickname ?? '-'}`);

    // 1. code 换 openid（session_key 仅内存使用，不落库）
    this.logger.log(`[AUTH] [LOG-AU-002] 调用 WxService.code2Session`);
    const { openid } = await this.wx.code2Session(dto.code);
    this.logger.log(`[AUTH] [LOG-AU-003] code2Session 返回: openid=${openid.slice(0, 6)}***(已脱敏)`);

    // 2. 昵称处理 + 敏感词检测
    const rawNick = (dto.userInfo?.nickname ?? '').toString().trim();
    const nickname = rawNick || `用户${openid.slice(-6)}`;
    this.logger.log(`[AUTH] [LOG-AU-004] 昵称处理: raw="${rawNick}" → final="${nickname}"`);
    if (this.sensitive.isSensitive(nickname)) {
      this.logger.warn(`[AUTH] [LOG-AU-005] ❌ 昵称命中敏感词,拒绝登录: nickname="${nickname}"`);
      throw new BadRequestException('昵称含敏感词，请修改后重试');
    }
    const avatar = dto.userInfo?.avatarUrl ?? null;

    // 3. 查找或创建用户；老用户更新昵称头像
    this.logger.log(`[AUTH] [LOG-AU-006] 查询用户: openid=${openid.slice(0, 6)}***`);
    let user = await this.prisma.user.findUnique({ where: { openid } });
    if (!user) {
      this.logger.log(`[AUTH] [LOG-AU-007] 用户不存在,将创建新用户: nickname="${nickname}"`);
      user = await this.prisma.user.create({
        data: { openid, nickname, avatar },
      });
      this.logger.log(`[AUTH] [LOG-AU-008] 新用户已创建: userId=${user.id.toString()}`);
      // 4. 新用户自动初始化钱包（余额 0）
      this.logger.log(`[AUTH] [LOG-AU-009] 调用 walletService.initWallet: userId=${user.id.toString()}`);
      await this.walletService.initWallet(user.id);
      this.logger.log(`[AUTH] [LOG-AU-010] 钱包初始化完成: userId=${user.id.toString()}`);
    } else {
      this.logger.log(`[AUTH] [LOG-AU-011] 老用户已存在: userId=${user.id.toString()}, role=${user.role}, 将更新昵称/头像`);
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { nickname, avatar: avatar ?? user.avatar },
      });
      this.logger.log(`[AUTH] [LOG-AU-012] 用户资料已更新: userId=${user.id.toString()}`);
    }

    this.logger.log(`[AUTH] [LOG-AU-013] wxLogin 完成,签发 Token: userId=${user.id.toString()}, role=${user.role}`);
    return this.issueTokens(user);
  }

  /** 测试登录：直接签发 Token（跳过微信 code2Session，仅开发环境使用） */
  async testLogin(userId?: string, mockNickname?: string): Promise<LoginResult> {
    this.logger.log(`[AUTH] [LOG-AU-101] testLogin 入口: userId=${userId ?? '(空,创建新mock用户)'}, mockNickname=${mockNickname ?? '-'}`);
    if (userId) {
      this.logger.log(`[AUTH] [LOG-AU-102] 按 userId 查询: id=${userId}`);
      const user = await this.prisma.user.findUnique({
        where: { id: BigInt(userId) },
      });
      if (!user) {
        this.logger.warn(`[AUTH] [LOG-AU-103] ❌ 用户不存在,抛 NotFoundException: userId=${userId}`);
        throw new NotFoundException('用户不存在');
      }
      this.logger.log(`[AUTH] [LOG-AU-104] testLogin 匹配用户: userId=${user.id.toString()}, role=${user.role}, status=${user.status}`);
      return this.issueTokens(user);
    }

    // 无 userId → 创建新用户（mock openid）
    const openid = `mock_user_${Date.now()}`;
    this.logger.log(`[AUTH] [LOG-AU-105] 无 userId,生成 mock openid: ${openid}`);
    let user = await this.prisma.user.findUnique({ where: { openid } });
    if (!user) {
      this.logger.log(`[AUTH] [LOG-AU-106] openid 未占用,创建 mock 新用户: nickname="${mockNickname || 'Mock用户'}"`);
      user = await this.prisma.user.create({
        data: {
          openid,
          nickname: mockNickname || 'Mock用户',
          avatar: null,
        },
      });
      this.logger.log(`[AUTH] [LOG-AU-107] mock 用户已创建: userId=${user.id.toString()}`);
      await this.walletService.initWallet(user.id);
      this.logger.log(`[AUTH] [LOG-AU-108] mock 用户钱包初始化完成: userId=${user.id.toString()}`);
    } else {
      this.logger.log(`[AUTH] [LOG-AU-109] openid 已存在(极罕见并发碰撞): userId=${user.id.toString()},复用原用户`);
    }
    this.logger.log(`[AUTH] [LOG-AU-110] testLogin 完成,签发 Token: userId=${user.id.toString()}, role=${user.role}`);
    return this.issueTokens(user);
  }

  /** 刷新 Token：校验 → 旋转（旧 refresh 入黑名单）→ 重发 */
  async refresh(dto: RefreshDto): Promise<LoginResult> {
    const tokenPreview = dto.refreshToken ? dto.refreshToken.slice(0, 12) + '...' : '(空)';
    this.logger.log(`[AUTH] [LOG-AU-201] refresh 入口: refreshToken=${tokenPreview}`);
    let payload: RefreshJwtPayload;
    try {
      payload = this.jwt.verify(dto.refreshToken, {
        secret: this.refreshSecret,
      }) as RefreshJwtPayload;
      this.logger.log(`[AUTH] [LOG-AU-202] 签名校验通过: sub=${payload.sub}, type=${payload.type}, exp=${payload.exp ?? '-'}`);
    } catch (e) {
      this.logger.warn(`[AUTH] [LOG-AU-203] ❌ Refresh Token 签名校验失败: ${(e as Error).message}`);
      throw new UnauthorizedException('Refresh Token 无效或已过期');
    }

    if (payload.type !== 'refresh') {
      this.logger.warn(`[AUTH] [LOG-AU-204] ❌ Token 类型错误: actual=${payload.type}, expected=refresh`);
      throw new UnauthorizedException('Token 类型错误');
    }
    if (this.blacklist.isBlacklisted(dto.refreshToken)) {
      this.logger.warn(`[AUTH] [LOG-AU-205] ❌ Refresh Token 已在黑名单(已被使用过): sub=${payload.sub}`);
      throw new UnauthorizedException('Refresh Token 已失效，请重新登录');
    }

    this.logger.log(`[AUTH] [LOG-AU-206] 查询用户信息: sub=${payload.sub}`);
    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(payload.sub) },
    });
    if (!user || user.status !== 'ACTIVE') {
      this.logger.warn(`[AUTH] [LOG-AU-207] ❌ 用户不存在或非 ACTIVE: sub=${payload.sub}, userExists=${!!user}, status=${user?.status ?? '-'}`);
      throw new UnauthorizedException('用户不存在或已禁用');
    }
    this.logger.log(`[AUTH] [LOG-AU-208] 用户校验通过: userId=${user.id.toString()}, role=${user.role}`);

    // Token Rotation：旧 refresh 立即失效
    this.logger.log(`[AUTH] [LOG-AU-209] 将旧 Refresh Token 加入黑名单(Token Rotation): ttl=${REFRESH_TTL_SEC}s`);
    this.blacklist.blacklist(dto.refreshToken, REFRESH_TTL_SEC);
    this.logger.log(`[AUTH] [LOG-AU-210] refresh 完成,重发新 Token: userId=${user.id.toString()}`);
    return this.issueTokens(user);
  }

  /** 登出：access + refresh 全部入黑名单 */
  async logout(accessToken: string, refreshToken?: string): Promise<void> {
    const accPreview = accessToken ? accessToken.slice(0, 12) + '...' : '(空)';
    const refPreview = refreshToken ? refreshToken.slice(0, 12) + '...' : '(空)';
    this.logger.log(`[AUTH] [LOG-AU-301] logout 入口: accessToken=${accPreview}, refreshToken=${refPreview}`);
    try {
      const decoded = this.jwt.decode(accessToken) as RefreshJwtPayload | null;
      const exp = decoded?.exp ?? 0;
      const ttl = Math.max(0, exp - Math.floor(Date.now() / 1000));
      const sub = decoded?.sub ?? '-';
      if (ttl > 0) {
        this.logger.log(`[AUTH] [LOG-AU-302] Access Token 加入黑名单: sub=${sub}, ttl=${ttl}s`);
        this.blacklist.blacklist(accessToken, ttl);
      } else {
        this.logger.log(`[AUTH] [LOG-AU-303] Access Token 已过期，跳过加黑: sub=${sub}, exp=${exp}`);
      }
    } catch (e) {
      this.logger.warn(`[AUTH] [LOG-AU-304] ⚠️ Access Token decode 失败，跳过加黑: ${(e as Error).message}`);
      // access token 无法解析则忽略
    }
    if (refreshToken) {
      this.logger.log(`[AUTH] [LOG-AU-305] Refresh Token 加入黑名单: ttl=${REFRESH_TTL_SEC}s`);
      this.blacklist.blacklist(refreshToken, REFRESH_TTL_SEC);
    } else {
      this.logger.log(`[AUTH] [LOG-AU-306] 未提供 Refresh Token,仅失效 Access`);
    }
    this.logger.log(`[AUTH] [LOG-AU-307] logout 完成`);
  }

  /** 获取当前登录用户信息 */
  async me(userId: string): Promise<UserInfoPayload> {
    this.logger.log(`[AUTH] [LOG-AU-401] me 入口: userId=${userId}`);
    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(userId) },
    });
    if (!user) {
      this.logger.warn(`[AUTH] [LOG-AU-402] ❌ 用户不存在: userId=${userId}`);
      throw new NotFoundException('用户不存在');
    }
    this.logger.log(`[AUTH] [LOG-AU-403] me 返回: userId=${user.id.toString()}, role=${user.role}, status=${user.status}, nickname="${user.nickname}"`);
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
      openid: user.openid,
    };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: ACCESS_TTL_SEC,
    });
    const refreshToken = this.jwt.sign(
      { sub: user.id.toString(), type: 'refresh' },
      { secret: this.refreshSecret, expiresIn: REFRESH_TTL_SEC },
    );
    this.logger.log(
      `[AUTH] [LOG-AU-501] 签发 Token: userId=${user.id.toString()}, role=${user.role}, ` +
        `accessExpiresIn=${ACCESS_TTL_SEC}s, refreshExpiresIn=${REFRESH_TTL_SEC}s, ` +
        `accessToken.preview=${accessToken.slice(0, 16)}..., ` +
        `refreshToken.preview=${refreshToken.slice(0, 16)}...`,
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
