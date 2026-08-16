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
import { VerificationService } from '../verification/verification.service';
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
    private readonly verification: VerificationService,
  ) {}

  /**
   * GET /api/v1/wallet — 查询余额
   */
  @Get()
  async getBalance(@Req() req: AuthenticatedRequest) {
    const userId = BigInt(req.user.sub);
    this.logger.log(`[WALLET] [LOG-WC-001] GET /wallet 余额查询入口: userId=${userId.toString()}`);
    const result = await this.walletService.getBalance(userId);
    this.logger.log(
      `[WALLET] [LOG-WC-002] /wallet 余额查询完成: userId=${userId.toString()}, ` +
        `balance=¥${result.balance.toFixed(2)}, frozen=¥${result.frozen.toFixed(2)}, available=¥${result.available.toFixed(2)}`,
    );
    return result;
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
    this.logger.log(
      `[WALLET] [LOG-WC-003] GET /wallet/transactions 入口: userId=${userId.toString()}, page=${page}, pageSize=${pageSize}, typeFilter=${type ?? '(全)'}`,
    );
    const result = await this.walletService.getTransactions(userId, page, pageSize, type);
    this.logger.log(
      `[WALLET] [LOG-WC-004] /wallet/transactions 完成: userId=${userId.toString()}, 命中 ${result.items.length}/${result.total} 条, hasMore=${result.hasMore}`,
    );
    return result;
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
    this.logger.log(
      `[WALLET] [LOG-WD-001] POST /wallet/withdraw 入口: userId=${userId.toString()}, ` +
        `openid=${openid ? openid.slice(0, 6) + '***' : '(空)'}, amount=¥${amount}`,
    );

    // 0. 前置校验：须完成手机号绑定、银行卡绑定、实名认证
    await this.verification.requireVerified(userId);

    // 1. 参数校验
    if (amount < 1) {
      this.logger.warn(
        `[WALLET] [LOG-WD-002] ❌ 提现金额小于最低 1 元,拒绝: userId=${userId.toString()}, amount=¥${amount}`,
      );
      throw new BadRequestException('最低提现 1 元');
    }
    if (amount > MAX_WITHDRAW_AMOUNT) {
      this.logger.warn(
        `[WALLET] [LOG-WD-003] ❌ 单笔提现超过上限 ${MAX_WITHDRAW_AMOUNT} 元,拒绝: ` +
          `userId=${userId.toString()}, amount=¥${amount}`,
      );
      throw new BadRequestException(`单笔提现不能超过 ${MAX_WITHDRAW_AMOUNT} 元`);
    }
    this.logger.log(`[WALLET] [LOG-WD-004] 参数校验通过: amount=¥${amount}`);

    // 2. 限流：每小时最多 3 次提现（Redis 不可用时降级放行）
    this.logger.log(
      `[WALLET] [LOG-WD-005] 限流检查: key=ratelimit:withdraw:${userId.toString()}, window=${WITHDRAW_RATE_LIMIT_WINDOW_SEC}s, limit=${WITHDRAW_RATE_LIMIT_POINTS}次`,
    );
    const rateLimit = await this.redisService.rateLimit(
      `ratelimit:withdraw:${userId}`,
      WITHDRAW_RATE_LIMIT_POINTS,
      WITHDRAW_RATE_LIMIT_WINDOW_SEC,
    );
    if (!rateLimit.allowed) {
      this.logger.warn(
        `[WALLET] [LOG-WD-006] ❌ 提现限流被拒: userId=${userId.toString()}, ` +
          `count=${rateLimit.remaining ? WITHDRAW_RATE_LIMIT_POINTS - rateLimit.remaining : '?'} / ${WITHDRAW_RATE_LIMIT_POINTS}`,
      );
      throw new HttpException(
        `提现过于频繁，每小时最多 ${WITHDRAW_RATE_LIMIT_POINTS} 次，请稍后再试`,
        429,
      );
    }
    this.logger.log(
      `[WALLET] [LOG-WD-007] 限流通过: remaining=${rateLimit.remaining}, windowSec=${WITHDRAW_RATE_LIMIT_WINDOW_SEC}`,
    );

    // 3. 大额需审核
    if (amount > LARGE_WITHDRAW_THRESHOLD) {
      this.logger.log(
        `[WALLET] [LOG-WD-008] 💰 提现金额 > ${LARGE_WITHDRAW_THRESHOLD} 元,进入人工审核队列: ` +
          `userId=${userId.toString()}, amount=¥${amount}`,
      );
      return {
        status: 'AUDIT_REQUIRED',
        message: `提现金额超过 ${LARGE_WITHDRAW_THRESHOLD} 元，已提交人工审核，请耐心等待`,
        amount,
      };
    }
    this.logger.log(`[WALLET] [LOG-WD-009] 金额 ≤ 阈值,进入自动提现流程: amount=¥${amount}`);

    // 4. 冻结提现金额（独立事务，确保冻结成功后再调用外部API）
    this.logger.log(
      `[WALLET] [LOG-WD-010] 开始冻结: userId=${userId.toString()}, FREEZE ¥${amount}`,
    );
    await this.walletService.recordTransaction(userId, 'FREEZE', amount, `提现冻结 ${amount} 元`);
    this.logger.log(
      `[WALLET] [LOG-WD-011] ✅ 冻结成功: userId=${userId.toString()}, amount=¥${amount}`,
    );

    try {
      if (!openid) {
        this.logger.error(
          `[WALLET] [LOG-WD-012] ❌ 缺少 openid,无法发起微信提现: userId=${userId.toString()}`,
        );
        throw new BadRequestException('缺少微信 openid，无法提现');
      }
      // 5. 调用微信企业付款 API（V3 版本）
      this.logger.log(
        `[WALLET] [LOG-WD-013] 调用 transferToWxWallet: openid.preview=${openid.slice(0, 6)}***, amount=¥${amount}`,
      );
      const result = await this.transferToWxWallet(openid, amount);

      if (result.status === 'SUCCESS') {
        // 4a. 成功 → 原子确认：UNFREEZE + EXPENSE 在同一事务内
        this.logger.log(
          `[WALLET] [LOG-WD-014] ✅ 微信提现返回 SUCCESS, transactionId=${result.transactionId}, 开始 confirmWithdraw`,
        );
        await this.walletService.confirmWithdraw(userId, amount, result.transactionId);
        this.logger.log(
          `[WALLET] [LOG-WD-015] ✅ 提现完成(UNFREEZE+EXPENSE 原子确认): userId=${userId.toString()}, amount=¥${amount}, txnId=${result.transactionId}`,
        );

        return {
          status: 'SUCCESS',
          message: '提现成功，预计 1-3 个工作日到账',
          transactionId: result.transactionId,
          amount,
        };
      } else {
        this.logger.warn(
          `[WALLET] [LOG-WD-016] ❌ 微信提现返回非 SUCCESS: status=${result.status}, 转入回滚流程`,
        );
        throw new ServiceUnavailableException('微信返回提现失败');
      }
    } catch (err) {
      // 4b. 失败 → 原子解冻（独立事务，确保冻结金额完整退回）
      const errMsg = (err as Error).message;
      this.logger.error(
        `[WALLET] [LOG-WD-017] ❌ 提现异常,启动回滚解冻: userId=${userId.toString()}, ` +
          `amount=¥${amount}, error=${errMsg}`,
      );
      await this.walletService.rollbackWithdraw(userId, amount);
      this.logger.log(
        `[WALLET] [LOG-WD-018] ✅ 回滚解冻成功: userId=${userId.toString()}, amount=¥${amount}`,
      );
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
    this.logger.log(
      `[WALLET] [LOG-WT-001] POST /wallet/transfer 入口: from=${fromUserId.toString()} → to=${toUserId.toString()}, amount=¥${dto.amount}, desc="${description}"`,
    );

    // 验证接收方存在
    this.logger.log(`[WALLET] [LOG-WT-002] 校验接收方存在: toUserId=${toUserId.toString()}`);
    const toUser = await this.prisma.user.findUnique({
      where: { id: toUserId },
    });
    if (!toUser) {
      this.logger.warn(`[WALLET] [LOG-WT-003] ❌ 接收方不存在: toUserId=${toUserId.toString()}`);
      throw new BadRequestException('接收方用户不存在');
    }
    this.logger.log(
      `[WALLET] [LOG-WT-004] 接收方校验通过: toUser.nickname="${toUser.nickname}", status=${toUser.status}`,
    );

    this.logger.log(
      `[WALLET] [LOG-WT-005] 开始 walletService.transfer: from=${fromUserId.toString()} → to=${toUserId.toString()}, ¥${dto.amount}`,
    );
    await this.walletService.transfer(fromUserId, toUserId, dto.amount, description);
    this.logger.log(
      `[WALLET] [LOG-WT-006] ✅ 转账成功: from=${fromUserId.toString()} → to=${toUserId.toString()}, ¥${dto.amount}`,
    );

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

    this.logger.log(
      `[WALLET] [LOG-WT-101] 调用微信提现企业付款: outTradeNo=${outTradeNo}, openid.preview=${openid.slice(0, 6)}***, amount=¥${amount}`,
    );

    // 开发环境：模拟成功
    if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        `[WALLET] [LOG-WT-102] ⚠️ 开发环境：模拟微信提现成功 (NO_PROD=true), outTradeNo=${outTradeNo}`,
      );
      return {
        status: 'SUCCESS',
        transactionId: `MOCK_TX_${outTradeNo}`,
      };
    }

    // TODO: 生产环境实现真实 HTTP 调用
    // 实际需要调用: POST https://api.mch.weixin.qq.com/v3/transfer/batches
    // 或使用企业付款到零钱 API
    this.logger.log(
      `[WALLET] [LOG-WT-103] 生产环境 TODO: 真实 HTTP 调用微信企业付款 outTradeNo=${outTradeNo}`,
    );

    return {
      status: 'SUCCESS',
      transactionId: `PROD_TX_${outTradeNo}`,
    };
  }
}
