import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard, RequirePermissions } from '../../../auth/guards/permission.guard';
import { PERMISSIONS } from '../../../auth/permissions';
import { ProfitSharingService } from './profit-sharing.service';
import { CreateProfitSharingRuleDto } from './dto/create-profit-sharing-rule.dto';
import { UpdateProfitSharingRuleDto } from './dto/update-profit-sharing-rule.dto';

@ApiTags('平台-分账规则管理（工作人员/老板）')
@Controller('admin/profit-sharing-rules')
@UseGuards(PermissionGuard)
@RequirePermissions(PERMISSIONS.PROFIT_SHARING_MANAGE)
@ApiBearerAuth()
export class ProfitSharingController {
  constructor(private readonly profitSharingService: ProfitSharingService) {}

  private adminId(req: Request): string {
    return (req as unknown as { user: { sub: string } }).user.sub;
  }

  @ApiOperation({ summary: '创建分账规则' })
  @ApiBody({ type: CreateProfitSharingRuleDto })
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateProfitSharingRuleDto, @Req() req: Request, @Ip() ip: string) {
    return this.profitSharingService.create(dto, this.adminId(req), ip);
  }

  @ApiOperation({ summary: '查询所有分账规则（含 inactive，按 priority desc, createdAt desc）' })
  @Get()
  findAll() {
    return this.profitSharingService.findAll();
  }

  @ApiOperation({ summary: '查询分账规则详情' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.profitSharingService.findOne(id);
  }

  @ApiOperation({ summary: '更新分账规则' })
  @ApiBody({ type: UpdateProfitSharingRuleDto })
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProfitSharingRuleDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.profitSharingService.update(id, dto, this.adminId(req), ip);
  }

  @ApiOperation({ summary: '删除分账规则' })
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string, @Req() req: Request, @Ip() ip: string) {
    return this.profitSharingService.remove(id, this.adminId(req), ip);
  }
}

/**
 * 用户端只读视图：所有登录用户均可查看当前生效的分账比例 + 微信渠道费率。
 * 接单用户在结算/提现时查看，不可编辑。
 */
@ApiTags('用户-分账比例（只读）')
@Controller('profit-sharing')
@UseGuards(PermissionGuard)
@ApiBearerAuth()
export class ProfitSharingViewController {
  constructor(private readonly profitSharingService: ProfitSharingService) {}

  @ApiOperation({ summary: '查看当前生效的分账规则（只读）' })
  @Get('rules')
  findActiveRules() {
    return this.profitSharingService.findActiveRules();
  }

  @ApiOperation({ summary: '查看微信支付渠道费率（只读，底层硬编码 0.6%）' })
  @Get('wechat-fee-rate')
  wechatFeeRate() {
    return this.profitSharingService.getWechatChannelRate();
  }
}
