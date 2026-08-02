import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenBlacklistService } from '../../common/token-blacklist.service';

/**
 * JWT 认证守卫
 * - 校验 Bearer Token 签名
 * - 检查黑名单（登出 / 旋转失效的 Token 立即拒绝）
 * - 失败统一抛 401，供前端 request 拦截器触发刷新 / 跳登录
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly blacklist: TokenBlacklistService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('未登录');
    }

    const token = authHeader.split(' ')[1];
    let payload: unknown;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }

    if (this.blacklist.isBlacklisted(token)) {
      throw new UnauthorizedException('Token 已失效');
    }

    request.user = payload;
    return true;
  }
}
