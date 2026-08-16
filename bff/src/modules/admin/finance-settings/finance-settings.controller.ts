import {
  Controller,
  Get,
  Put,
  Body,
  Req,
  UseGuards,
  HttpCode,
  Ip,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminGuard, Roles } from '../../../auth/guards/admin.guard';
import { FinanceSettingsService } from './finance-settings.service';
import { SaveFinanceSettingDto } from './dto/save-finance-setting.dto';

@ApiTags('老板-财务设置（仅 BOSS/SUPER_ADMIN）')
@Controller('admin/finance-settings')
@UseGuards(AdminGuard)
@Roles('BOSS', 'SUPER_ADMIN')
@ApiBearerAuth()
export class FinanceSettingsController {
  private readonly logger = new Logger(FinanceSettingsController.name);

  constructor(private readonly service: FinanceSettingsService) {}

  private bossId(req: Request): string {
    const sub = (req as unknown as { user: { sub: string } }).user.sub;
    this.logger.log(`[FS-LOG] bossId 提取: sub=${sub}`);
    return sub;
  }

  @ApiOperation({
    summary: '查询财务设置（平台佣金收款账号 + 主商户号/AppID 覆盖配置）',
    description: '单例：DB 中仅有一行 id=1；如果尚未保存，返回 null（前端展示为空表单）。',
  })
  @Get()
  get() {
    this.logger.log(`[FS-LOG] GET /admin/finance-settings 入口`);
    return this.service.get();
  }

  @ApiOperation({
    summary: '保存财务设置（upsert 单例）',
    description:
      '仅 BOSS / SUPER_ADMIN 可调用。保存后立即生效，后续支付回调触发分账时会从 DB 读取接收方。',
  })
  @ApiBody({ type: SaveFinanceSettingDto })
  @Put()
  @HttpCode(200)
  save(@Body() dto: SaveFinanceSettingDto, @Req() req: Request, @Ip() ip: string) {
    const bossId = this.bossId(req);
    this.logger.log(
      `[FS-LOG] PUT /admin/finance-settings 入口: bossId=${bossId}, ip=${ip}, ` +
        `profitSharingEnabled=${dto.profitSharingEnabled}, receiverType=${dto.receiverType}, ` +
        `receiverMchId=${dto.receiverMchId ? '已配置' : '未配置'}, ` +
        `mainMchId=${dto.mainMchId ?? '-'}, mainAppId=${dto.mainAppId ?? '-'}`,
    );
    return this.service.save(dto, bossId, ip);
  }
}
