import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ALL_PERMISSIONS, PERMISSION_LABELS, FULL_ACCESS_ROLES } from '../../../auth/permissions';

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 列出全部可分配权限及其说明 */
  findAvailable(): { permission: string; label: string }[] {
    return ALL_PERMISSIONS.map((p) => ({ permission: p, label: PERMISSION_LABELS[p] }));
  }

  /** 老板视角：列出所有工作人员及其拥有的权限 */
  async findAll(): Promise<
    {
      userId: string;
      nickname: string;
      avatar: string | null;
      role: string;
      permissions: { permission: string; label: string; grantedAt: string }[];
    }[]
  > {
    const staffUsers = await this.prisma.user.findMany({
      where: { role: 'STAFF' },
      select: {
        id: true,
        nickname: true,
        avatar: true,
        role: true,
        staffPermissions: { select: { permission: true, grantedAt: true } },
      },
      orderBy: { id: 'asc' },
    });

    return staffUsers.map((u) => ({
      userId: u.id.toString(),
      nickname: u.nickname,
      avatar: u.avatar,
      role: u.role,
      permissions: u.staffPermissions.map((p) => ({
        permission: p.permission,
        label: PERMISSION_LABELS[p.permission] ?? p.permission,
        grantedAt: p.grantedAt.toISOString(),
      })),
    }));
  }

  /**
   * 当前用户的有效权限
   * 从 DB 实时读取 role，避免 JWT 过期导致角色变更不生效
   * BOSS / SUPER_ADMIN / ADMIN → 全部权限
   * STAFF → 已授权权限列表
   * 其余 → 空
   */
  async findMine(userId: string): Promise<{ role: string; permissions: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { id: true, role: true },
    });
    if (!user) return { role: 'USER', permissions: [] };

    if (FULL_ACCESS_ROLES.includes(user.role)) {
      return { role: user.role, permissions: [...ALL_PERMISSIONS] };
    }
    if (user.role !== 'STAFF') {
      return { role: user.role, permissions: [] };
    }
    const rows = await this.prisma.staffPermission.findMany({
      where: { userId: user.id },
      select: { permission: true },
    });
    return { role: user.role, permissions: rows.map((r) => r.permission) };
  }

  /** 老板授权：给 STAFF 用户授予某项权限 */
  async grant(
    userId: string,
    permission: string,
    grantedBy: string,
    ip?: string,
  ): Promise<{ success: boolean }> {
    const targetUid = BigInt(userId);

    const target = await this.prisma.user.findUnique({ where: { id: targetUid } });
    if (!target) throw new NotFoundException('目标用户不存在');
    if (target.role !== 'STAFF') {
      throw new BadRequestException('仅可对工作人员(STAFF)角色授权，请先将该用户设为 STAFF');
    }

    try {
      await this.prisma.staffPermission.upsert({
        where: { userId_permission: { userId: targetUid, permission } },
        update: { grantedBy: BigInt(grantedBy) },
        create: { userId: targetUid, permission, grantedBy: BigInt(grantedBy) },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('该权限已授权');
      }
      throw err;
    }

    await this.writeAuditLog(grantedBy, 'GRANT_PERMISSION', targetUid, { permission }, ip);
    this.logger.log(`授权成功: userId=${userId}, permission=${permission}, by=${grantedBy}`);
    return { success: true };
  }

  /** 老板撤销：移除 STAFF 用户的某项权限 */
  async revoke(
    userId: string,
    permission: string,
    revokedBy: string,
    ip?: string,
  ): Promise<{ success: boolean }> {
    const targetUid = BigInt(userId);

    const existing = await this.prisma.staffPermission.findUnique({
      where: { userId_permission: { userId: targetUid, permission } },
    });
    if (!existing) {
      throw new NotFoundException('该用户未拥有此权限');
    }

    await this.prisma.staffPermission.delete({
      where: { userId_permission: { userId: targetUid, permission } },
    });

    await this.writeAuditLog(revokedBy, 'REVOKE_PERMISSION', targetUid, { permission }, ip);
    this.logger.log(`撤销权限: userId=${userId}, permission=${permission}, by=${revokedBy}`);
    return { success: true };
  }

  /** 将指定用户角色提升为 STAFF（便于老板把普通用户设为工作人员） */
  async setStaffRole(
    userId: string,
    bossId: string,
    ip?: string,
  ): Promise<{ success: boolean; role: string }> {
    const targetUid = BigInt(userId);
    const target = await this.prisma.user.findUnique({ where: { id: targetUid } });
    if (!target) throw new NotFoundException('目标用户不存在');
    if (FULL_ACCESS_ROLES.includes(target.role)) {
      throw new ForbiddenException('不能修改老板/超管角色');
    }

    await this.prisma.user.update({
      where: { id: targetUid },
      data: { role: 'STAFF' },
    });

    await this.writeAuditLog(
      bossId,
      'SET_STAFF_ROLE',
      targetUid,
      { previousRole: target.role },
      ip,
    );
    return { success: true, role: 'STAFF' };
  }

  private async writeAuditLog(
    bossId: string,
    action: string,
    targetId: bigint,
    detail: unknown,
    ip?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          adminId: BigInt(bossId),
          action,
          targetType: 'STAFF_PERMISSION',
          targetId,
          detail: (detail ?? {}) as Prisma.InputJsonValue,
          ip: ip ?? '127.0.0.1',
        },
      });
    } catch (err) {
      this.logger.warn(`写入审计日志失败: ${(err as Error).message}`);
    }
  }
}
