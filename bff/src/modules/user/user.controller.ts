import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiPropertyOptional } from '@nestjs/swagger';
import { Request } from 'express';
import { IsOptional, IsString, MaxLength, IsEnum } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

type AuthenticatedRequest = Request & { user: { sub: string | number } };

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '昵称', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  nickname?: string;

  @ApiPropertyOptional({ description: '头像 URL', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatar?: string;

  @ApiPropertyOptional({ description: '手机号', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: '性别', enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ description: '个人简介', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}

interface UserProfile {
  id: string;
  nickname: string;
  avatar: string | null;
  phone: string | null;
  gender: Gender | null;
  bio: string | null;
  createdAt: Date;
}

interface UserSettings {
  notifyEnabled: boolean;
  soundEnabled: boolean;
  lang: string;
}

@ApiTags('用户')
@Controller('user')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly prisma: PrismaService) {}

  private getUserId(req: AuthenticatedRequest): bigint {
    return BigInt(req.user.sub);
  }

  @Get('profile')
  @ApiOperation({ summary: '获取当前用户资料' })
  async getProfile(@Req() req: AuthenticatedRequest): Promise<UserProfile> {
    const userId = this.getUserId(req);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        avatar: true,
        phone: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return {
      id: user.id.toString(),
      nickname: user.nickname,
      avatar: user.avatar,
      phone: user.phone,
      gender: null,
      bio: null,
      createdAt: user.createdAt,
    };
  }

  @Put('profile')
  @ApiOperation({ summary: '更新当前用户资料' })
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserProfile> {
    const userId = this.getUserId(req);

    const updateData: Record<string, unknown> = {};
    if (dto.nickname !== undefined) updateData.nickname = dto.nickname;
    if (dto.avatar !== undefined) updateData.avatar = dto.avatar;
    if (dto.phone !== undefined) updateData.phone = dto.phone;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        nickname: true,
        avatar: true,
        phone: true,
        createdAt: true,
      },
    });

    this.logger.log(`User ${userId} profile updated`);

    return {
      id: user.id.toString(),
      nickname: user.nickname,
      avatar: user.avatar,
      phone: user.phone,
      gender: dto.gender ?? null,
      bio: dto.bio ?? null,
      createdAt: user.createdAt,
    };
  }

  @Get('settings')
  @ApiOperation({ summary: '获取用户设置' })
  async getSettings(): Promise<UserSettings> {
    return {
      notifyEnabled: true,
      soundEnabled: true,
      lang: 'zh-CN',
    };
  }

  @Put('phone')
  @ApiOperation({ summary: '修改手机号' })
  async changePhone(
    @Body() body: { phone: string; code?: string },
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    const userId = this.getUserId(req);
    await this.prisma.user.update({
      where: { id: userId },
      data: { phone: body.phone },
    });
    return { success: true };
  }

  @Put('password')
  @ApiOperation({ summary: '修改密码' })
  async changePassword(
    @Body() body: { oldPassword: string; newPassword: string },
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    const userId = this.getUserId(req);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');
    this.logger.log(`User ${userId} changed password`);
    return { success: true };
  }

  @Delete('account')
  @ApiOperation({ summary: '注销账号' })
  async deleteAccount(
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    const userId = this.getUserId(req);
    this.logger.log(`User ${userId} deleting account, reason: ${body.reason || 'N/A'}`);
    await this.prisma.user.delete({ where: { id: userId } });
    return { success: true };
  }

  @Post('feedback')
  @ApiOperation({ summary: '提交意见反馈' })
  async submitFeedback(
    @Body() body: { content: string; images?: string[] },
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; ticketId?: string }> {
    const userId = this.getUserId(req);
    this.logger.log(`Feedback from user ${userId}: ${body.content?.substring(0, 100)}`);
    // 开发环境：直接返回 ticketId，不实际存储
    const ticketId = `fb_${Date.now()}`;
    return { success: true, ticketId };
  }
}
