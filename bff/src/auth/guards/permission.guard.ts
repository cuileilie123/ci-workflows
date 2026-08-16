import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TokenBlacklistService } from '../../common/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FULL_ACCESS_ROLES } from '../permissions';

export const PERMISSIONS_KEY = 'permissions';
/** 标记端点所需的细粒度权限（STAFF 需显式授权；BOSS/SUPER_ADMIN/ADMIN 自动放行） */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

interface RequestUser {
  sub: string;
  role: string;
}

/**
 * 权限守卫：
 * 1. 完成 JWT 认证（与 JwtAuthGuard 等价）
 * 2. BOSS/SUPER_ADMIN/ADMIN 自动放行
 * 3. STAFF 需在 staff_permissions 表中拥有所需权限
 * 4. 未声明所需权限时，仅认证即可（等价于 JwtAuthGuard）
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly blacklist: TokenBlacklistService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. JWT 认证
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

    const user = request.user as RequestUser;
    if (!user) {
      throw new ForbiddenException('未登录');
    }

    // 2. 所需权限
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 3. 从 DB 实时读取 role（避免 JWT 缓存导致角色变更不生效）
    const dbUser = await this.prisma.user.findUnique({
      where: { id: BigInt(user.sub) },
      select: { id: true, role: true },
    });
    const effectiveRole = dbUser?.role ?? user.role;

    // 4. 全权限角色直接放行
    if (FULL_ACCESS_ROLES.includes(effectiveRole)) {
      return true;
    }

    // 5. 未声明所需权限 → 仅认证即可
    if (!required || required.length === 0) {
      return true;
    }

    // 6. STAFF 需查询显式授权
    if (effectiveRole !== 'STAFF') {
      throw new ForbiddenException('无权限操作此功能');
    }

    const granted = await this.prisma.staffPermission.findMany({
      where: { userId: BigInt(user.sub), permission: { in: required } },
      select: { permission: true },
    });

    const grantedSet = new Set(granted.map((g) => g.permission));
    const missing = required.filter((p) => !grantedSet.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`缺少权限: ${missing.join(', ')}`);
    }

    return true;
  }
}
