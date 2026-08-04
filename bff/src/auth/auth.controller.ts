import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RefreshDto, WxLoginDto } from './dto/wx-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @ApiOperation({ summary: '微信登录（code 换 JWT + Refresh Token）' })
  @ApiBody({ type: WxLoginDto })
  @Post('wx-login')
  @HttpCode(200)
  wxLogin(@Body() dto: WxLoginDto) {
    return this.auth.wxLogin(dto);
  }

  @ApiOperation({ summary: '刷新 Access Token（Refresh Token Rotation）' })
  @ApiBody({ type: RefreshDto })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
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
    await this.auth.logout(accessToken, refreshToken);
    return { success: true };
  }

  @ApiOperation({ summary: '获取当前登录用户信息' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    const user = (req as unknown as { user: { sub: string } }).user;
    return this.auth.me(user.sub);
  }
}
