import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { TokenBlacklistService } from '../../common/token-blacklist.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AdminGuard extends JwtAuthGuard implements CanActivate {
  constructor(
    jwtService: JwtService,
    blacklist: TokenBlacklistService,
    private readonly reflector: Reflector,
  ) {
    super(jwtService, blacklist);
  }

  canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role: string };

    const roles = requiredRoles?.length ? requiredRoles : ['ADMIN', 'SUPER_ADMIN', 'BOSS'];

    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('需要管理员权限');
    }

    return true;
  }
}
