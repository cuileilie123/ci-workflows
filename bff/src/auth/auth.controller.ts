import { Body, Controller, Get, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RefreshDto, WxLoginDto } from './dto/wx-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: '微信登录（code 换 JWT + Refresh Token）' })
  @ApiBody({ type: WxLoginDto })
  @Post('wx-login')
  @HttpCode(200)
  wxLogin(@Body() dto: WxLoginDto) {
    const codePreview = dto.code ? dto.code.slice(0, 8) + '...' : '(空)';
    this.logger.log(`[AUTH] [LOG-AC-001] POST /auth/wx-login 入口: code.preview=${codePreview}, nickname=${dto.userInfo?.nickname ?? '-'}, deviceFp=${dto.deviceFp ?? '-'}`);
    return this.auth.wxLogin(dto);
  }

  @ApiOperation({ summary: '测试登录（开发环境专用，直接签发 Token）' })
  @Post('test-login')
  @HttpCode(200)
  testLogin(@Body() dto: { userId?: string; nickname?: string }) {
    this.logger.log(`[AUTH] [LOG-AC-002] POST /auth/test-login 入口: userId=${dto.userId ?? '(空)'}, nickname=${dto.nickname ?? '-'}`);
    return this.auth.testLogin(dto.userId, dto.nickname);
  }

  @ApiOperation({ summary: '刷新 Access Token（Refresh Token Rotation）' })
  @ApiBody({ type: RefreshDto })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    const tokenPreview = dto.refreshToken ? dto.refreshToken.slice(0, 12) + '...' : '(空)';
    this.logger.log(`[AUTH] [LOG-AC-003] POST /auth/refresh 入口: refreshToken.preview=${tokenPreview}`);
    return this.auth.refresh(dto);
  }

  @ApiOperation({ summary: '退出登录（Token 立即失效）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    const accessToken = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const refreshToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const sub = (req as unknown as { user?: { sub?: string } }).user?.sub ?? '-';
    this.logger.log(
      `[AUTH] [LOG-AC-004] POST /auth/logout 入口: sub=${sub}, ` +
        `hasAccessToken=${!!accessToken}, hasRefreshToken=${!!refreshToken}`,
    );
    await this.auth.logout(accessToken, refreshToken);
    this.logger.log(`[AUTH] [LOG-AC-005] /auth/logout 完成, sub=${sub}`);
    return { success: true };
  }

  @ApiOperation({ summary: '获取当前登录用户信息' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    const sub = (req as unknown as { user: { sub: string } }).user.sub;
    this.logger.log(`[AUTH] [LOG-AC-006] GET /auth/me 入口: sub=${sub}`);
    return this.auth.me(sub);
  }
}
