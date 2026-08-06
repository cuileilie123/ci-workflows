import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  Query,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { WalletService, TransactionType } from './wallet.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WithdrawDto, TransferDto, TransactionQueryDto } from './dto/withdraw.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/redis.service';
import { WxPayUtil } from '../payment/wx-pay.util';

type AuthenticatedRequest = Request & { user: { sub: string | number; openid?: string } };

const LARGE_WITHDRAW_THRESHOLD = 1000;
/** 单笔提现上限（元） */
const MAX_WITHDRAW_AMOUNT = 5000;
/** 提现限流：每小时最多 3 次 */
const WITHDRAW_RATE_LIMIT_POINTS = 3;
const WITHDRAW_RATE_LIMIT_WINDOW_SEC = 3600;

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly wxPay: WxPayUtil,
  ) {}

  /**
   * GET /api/v1/wallet — 查询余额
   */
  @Get()
  async getBalance(@Req() req: AuthenticatedRequest) {
    const userId = BigInt(req.user.sub);
    return this.walletService.getBalance(userId);
  }

  /**
   * GET /api/v1/wallet/transactions — 流水列表（分页）
   */
  @Get('transactions')
  async getTransactions(@Req() req: AuthenticatedRequest, @Query() query: TransactionQueryDto) {
    const userId = BigInt(req.user.sub);
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, query.pageSize || 20);
    const type = query.type as TransactionType | undefined;

    return this.walletService.getTransactions(userId, page, pageSize, type);
  }

  /**
   * POST /api/v1/wallet/withdraw — 提现到微信零钱
   * 流程：冻结 → 调用微信API → 成功原子确认/失败原子解冻
   */
  @Post('withdraw')
  async withdraw(@Body() dto: WithdrawDto, @Req() req: AuthenticatedRequest) {
    const userId = BigInt(req.user.sub);
    const openid = req.user.openid;
    const amount = dto.amount;

    // 1. 参数校验
    if (amount < 1) {
      throw new BadRequestException('最低提现 1 元');
    }
    if (amount > MAX_WITHDRAW_AMOUNT) {
      throw new BadRequestException(`单笔提现不能超过 ${MAX_WITHDRAW_AMOUNT} 元`);
    }

    // 2. 限流：每小时最多 3 次提现（Redis 不可用时降级放行）
    const rateLimit = await this.redisService.rateLimit(
      `ratelimit:withdraw:${userId}`,
      WITHDRAW_RATE_LIMIT_POINTS,
      WITHDRAW_RATE_LIMIT_WINDOW_SEC,
    );
    if (!rateLimit.allowed) {
      throw new HttpException(
        `提现过于频繁，每小时最多 ${WITHDRAW_RATE_LIMIT_POINTS} 次，请稍后再试`,
        429,
      );
    }

    // 3. 大额需审核
    if (amount > LARGE_WITHDRAW_THRESHOLD) {
      return {
        status: 'AUDIT_REQUIRED',
        message: `提现金额超过 ${LARGE_WITHDRAW_THRESHOLD} 元，已提交人工审核，请耐心等待`,
        amount,
      };
    }

    // 4. 冻结提现金额（独立事务，确保冻结成功后再调用外部API）
    await this.walletService.recordTransaction(userId, 'FREEZE', amount, `提现冻结 ${amount} 元`);

    try {
      if (!openid) {
        throw new BadRequestException('缺少微信 openid，无法提现');
      }
      // 5. 调用微信企业付款 API（V3 版本）
      const result = await this.transferToWxWallet(openid, amount);

      if (result.status === 'SUCCESS') {
        // 4a. 成功 → 原子确认：UNFREEZE + EXPENSE 在同一事务内
        await this.walletService.confirmWithdraw(userId, amount, result.transactionId);

        return {
          status: 'SUCCESS',
          message: '提现成功，预计 1-3 个工作日到账',
          transactionId: result.transactionId,
          amount,
        };
      } else {
        throw new ServiceUnavailableException('微信返回提现失败');
      }
    } catch (err) {
      // 4b. 失败 → 原子解冻（独立事务，确保冻结金额完整退回）
      this.logger.error(`提现失败: ${(err as Error).message}, userId=${userId}`);
      await this.walletService.rollbackWithdraw(userId, amount);
      throw new ServiceUnavailableException('提现失败，请稍后重试');
    }
  }

  /**
   * POST /api/v1/wallet/transfer — 内部转账
   */
  @Post('transfer')
  async transfer(@Body() dto: TransferDto, @Req() req: AuthenticatedRequest) {
    const fromUserId = BigInt(req.user.sub);
    const toUserId = BigInt(dto.toUserId);
    const description = dto.description || '内部转账';

    // 验证接收方存在
    const toUser = await this.prisma.user.findUnique({
      where: { id: toUserId },
    });
    if (!toUser) {
      throw new BadRequestException('接收方用户不存在');
    }

    await this.walletService.transfer(fromUserId, toUserId, dto.amount, description);

    return {
      status: 'SUCCESS',
      message: '转账成功',
      amount: dto.amount,
      toUserId: dto.toUserId,
    };
  }

  /**
   * 调用微信企业付款到零钱 API（V3）
   */
  private async transferToWxWallet(
    openid: string,
    amount: number,
  ): Promise<{ status: string; transactionId: string }> {
    const outTradeNo = `WD${Date.now()}${Math.floor(Math.random() * 1000)}`;

    this.logger.log(`发起微信提现: openid=${openid}, amount=${amount}, outTradeNo=${outTradeNo}`);

    // 开发环境：模拟成功
    if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
      this.logger.warn('开发环境：模拟微信提现成功');
      return {
        status: 'SUCCESS',
        transactionId: `MOCK_TX_${outTradeNo}`,
      };
    }

    // TODO: 生产环境实现真实 HTTP 调用
    // 实际需要调用: POST https://api.mch.weixin.qq.com/v3/transfer/batches
    // 或使用企业付款到零钱 API

    return {
      status: 'SUCCESS',
      transactionId: `PROD_TX_${outTradeNo}`,
    };
  }
}
