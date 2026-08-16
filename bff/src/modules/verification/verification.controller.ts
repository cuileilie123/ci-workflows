import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { VerificationService } from './verification.service';
import { BindPhoneDto, BankCardDto, RealNameDto } from './dto/verification.dto';

type AuthenticatedRequest = Request & { user: { sub: string | number } };

@ApiTags('认证绑定')
@Controller('verification')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VerificationController {
  private readonly logger = new Logger(VerificationController.name);

  constructor(private readonly verificationService: VerificationService) {}

  private getUserId(req: AuthenticatedRequest): bigint {
    return BigInt(req.user.sub);
  }

  @Get('status')
  @ApiOperation({ summary: '获取认证状态（手机号/银行卡/实名）' })
  async getStatus(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    this.logger.log(`[VERIFY] [LOG-VC-001] GET /verification/status: userId=${userId.toString()}`);
    return this.verificationService.getStatus(userId);
  }

  @Post('phone')
  @ApiOperation({ summary: '绑定手机号（微信 getPhoneNumber code 或直接传入）' })
  async bindPhone(@Body() dto: BindPhoneDto, @Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    this.logger.log(
      `[VERIFY] [LOG-VC-002] POST /verification/phone: userId=${userId.toString()}, mode=${dto.code ? 'wx_code' : 'direct'}`,
    );
    return this.verificationService.bindPhone(userId, dto);
  }

  @Get('bank-cards')
  @ApiOperation({ summary: '银行卡列表' })
  async listBankCards(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    return this.verificationService.listBankCards(userId);
  }

  @Post('bank-card')
  @ApiOperation({ summary: '绑定银行卡（须先完成实名认证，持卡人须与实名一致）' })
  async addBankCard(@Body() dto: BankCardDto, @Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    this.logger.log(
      `[VERIFY] [LOG-VC-003] POST /verification/bank-card: userId=${userId.toString()}, bank=${dto.bankName}, lastFour=${dto.cardNumber.slice(-4)}`,
    );
    return this.verificationService.addBankCard(userId, dto);
  }

  @Delete('bank-card/:id')
  @ApiOperation({ summary: '删除银行卡' })
  async deleteBankCard(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    this.logger.log(
      `[VERIFY] [LOG-VC-004] DELETE /verification/bank-card/${id}: userId=${userId.toString()}`,
    );
    await this.verificationService.deleteBankCard(userId, BigInt(id));
    return { success: true };
  }

  @Get('real-name')
  @ApiOperation({ summary: '获取实名认证信息' })
  async getRealName(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    return this.verificationService.getRealName(userId);
  }

  @Post('real-name')
  @ApiOperation({ summary: '提交实名认证（通过格式校验即认证成功）' })
  async submitRealName(@Body() dto: RealNameDto, @Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    this.logger.log(
      `[VERIFY] [LOG-VC-005] POST /verification/real-name: userId=${userId.toString()}`,
    );
    return this.verificationService.submitRealName(userId, dto);
  }
}
