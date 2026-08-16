import { Controller, Get, Post, Body, Req, UseGuards, HttpCode, Ip } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminGuard, Roles } from '../../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionService } from './permission.service';
import { GrantPermissionDto } from './dto/grant-permission.dto';

type AuthRequest = Request & { user: { sub: string; role: string } };

@ApiTags('平台-权限管理')
@Controller('admin/permissions')
@ApiBearerAuth()
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  private uid(req: AuthRequest): string {
    return String(req.user.sub);
  }

  @ApiOperation({ summary: '列出全部可分配权限' })
  @UseGuards(JwtAuthGuard)
  @Get('available')
  findAvailable() {
    return this.permissionService.findAvailable();
  }

  @ApiOperation({ summary: '当前登录用户的有效权限（前端按权限显隐功能入口）' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async findMine(@Req() req: AuthRequest) {
    return this.permissionService.findMine(this.uid(req));
  }

  @ApiOperation({ summary: '老板视角：列出所有工作人员及其权限' })
  @UseGuards(AdminGuard)
  @Roles('BOSS', 'SUPER_ADMIN')
  @Get()
  findAll() {
    return this.permissionService.findAll();
  }

  @ApiOperation({ summary: '老板授权：给工作人员授予某项权限' })
  @ApiBody({ type: GrantPermissionDto })
  @UseGuards(AdminGuard)
  @Roles('BOSS', 'SUPER_ADMIN')
  @Post('grant')
  @HttpCode(200)
  grant(@Body() dto: GrantPermissionDto, @Req() req: AuthRequest, @Ip() ip: string) {
    return this.permissionService.grant(dto.userId, dto.permission, this.uid(req), ip);
  }

  @ApiOperation({ summary: '老板撤销：移除工作人员的某项权限' })
  @ApiBody({ type: GrantPermissionDto })
  @UseGuards(AdminGuard)
  @Roles('BOSS', 'SUPER_ADMIN')
  @Post('revoke')
  @HttpCode(200)
  revoke(@Body() dto: GrantPermissionDto, @Req() req: AuthRequest, @Ip() ip: string) {
    return this.permissionService.revoke(dto.userId, dto.permission, this.uid(req), ip);
  }

  @ApiOperation({ summary: '老板：将普通用户提升为工作人员(STAFF)角色' })
  @ApiBody({ type: GrantPermissionDto })
  @UseGuards(AdminGuard)
  @Roles('BOSS', 'SUPER_ADMIN')
  @Post('set-staff')
  @HttpCode(200)
  setStaff(@Body() dto: GrantPermissionDto, @Req() req: AuthRequest, @Ip() ip: string) {
    return this.permissionService.setStaffRole(dto.userId, this.uid(req), ip);
  }
}
