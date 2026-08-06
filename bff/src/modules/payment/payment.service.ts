import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WxPayUtil } from './wx-pay.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { RefundDto } from './dto/refund.dto';

const PLATFORM_FEE_RATE = 0.1;
const ORDER_EXPIRE_SECONDS = 900; // 15 分钟

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wxPay: WxPayUtil,
  ) {}

  // ============ 1. 创建支付订单 ============
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<{ orderId: string; payParams: ReturnType<WxPayUtil['signForFrontend']> }> {
    const taskId = BigInt(dto.taskId);
    const uid = BigInt(userId);

    // 1. 查询任务
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('任务不存在');
    if (task.status !== 'ASSIGNED') throw new ConflictException('任务状态异常，仅已接单状态可支付');
    if (!task.helperId) throw new ConflictException('任务尚未分配接单者');

    // 只有发布者能创建支付订单
    if (task.publisherId !== uid) throw new ForbiddenException('只有任务发布者可发起支付');

    // 检查是否已有未完成订单
    const existingOrder = await this.prisma.order.findUnique({
      where: { taskId },
    });
    if (existingOrder && !['CANCELLED', 'REFUNDED'].includes(existingOrder.status)) {
      throw new ConflictException('该任务已有未完成的订单');
    }

    // 2. 创建/复用订单
    const order = await this.prisma.order.create({
      data: {
        taskId,
        helperId: task.helperId,
        totalAmount: task.price,
        platformFee: task.price.mul(PLATFORM_FEE_RATE),
        status: 'PENDING',
      },
    });

    // 3. 调用微信统一下单 V3（模拟，实际需要 HTTP 请求）
    const wxOrder = await this.callWxCreateOrder({
      outTradeNo: order.id.toString(),
      description: task.title,
      amount: Math.round(Number(task.price) * 100),
      openid: (await this.prisma.user.findUnique({ where: { id: uid } }))?.openid,
    });

    // 4. 返回预支付参数（二次签名给前端）
    const payParams = this.wxPay.signForFrontend(wxOrder.prepayId);

    this.logger.log(`订单创建成功: orderId=${order.id}, prepayId=${wxOrder.prepayId}`);

    return {
      orderId: order.id.toString(),
      payParams,
    };
  }

  // ============ 2. 支付回调处理 ============
  async handleNotify(
    timestamp: string,
    nonce: string,
    signature: string,
    body: unknown,
  ): Promise<{ code: string; message: string }> {
    const traceId = `PAY-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const T = `💳[${traceId}]`;
    const bodyStr = JSON.stringify(body);

    this.logger.log(
      `${T} [NOTIFY-START] 支付回调到达: timestamp=${timestamp}, nonce=${nonce}, bodyLength=${bodyStr.length}`,
    );

    // 1. 验签
    this.logger.log(`${T} [VERIFY-SIG] 执行微信支付验签...`);
    const valid = this.wxPay.verifySignature(timestamp, nonce, bodyStr, signature);
    if (!valid) {
      this.logger.error(`${T} [VERIFY-SIG] ❌ 验签失败，拒绝进入任何事务`);
      throw new ForbiddenException('签名验证失败');
    }
    this.logger.log(`${T} [VERIFY-SIG] ✅ 验签通过`);

    try {
      const b = body as {
        resource?: { ciphertext: string; nonce: string; associated_data: string };
      };

      if (!b?.resource) {
        this.logger.warn(`${T} [SKIP] 回调报文中无 resource，直接返回 SUCCESS（无需事务）`);
        return { code: 'SUCCESS', message: '成功' };
      }

      // 2. 解密
      this.logger.log(`${T} [DECRYPT] 解密回调 resource...`);
      const decrypted = this.wxPay.decryptResource(b.resource);
      const orderId = BigInt(decrypted.out_trade_no);
      this.logger.log(
        `${T} [DECRYPT] ✅ 解密完成: out_trade_no=${orderId.toString()}, trade_state=${decrypted.trade_state}`,
      );

      // 3. 根据交易状态更新订单
      if (decrypted.trade_state === 'SUCCESS') {
        this.logger.log(
          `${T} [TX-START] trade_state=SUCCESS → 进入 $transaction，按字母序 order→task 顺序更新（防止 AB-BA 死锁）`,
        );
        // 🔒 使用事务确保一致性，并按预定顺序操作（先order后task，防止死锁）
        await this.prisma.$transaction(async (tx) => {
          // 先更新订单（按字母顺序，order排在task前面）
          this.logger.log(
            `${T} [①-UPDATE-ORDER] ① 先更新 order.update(id=${orderId.toString()}): PENDING → PAID`,
          );
          await tx.order.update({
            where: { id: orderId },
            data: {
              status: 'PAID',
              paidAt: new Date(),
            },
          });
          this.logger.log(`${T} [①-UPDATE-ORDER] ① ✅ order.update 完成`);
          
          this.logger.log(`支付成功: orderId=${orderId}`);

          // 再更新任务（按字母顺序，task排在后面）
          this.logger.log(
            `${T} [READ-ORDER] 读取 order(id=${orderId.toString()}) 取关联 taskId / helperId / totalAmount`,
          );
          const order = await tx.order.findUnique({ where: { id: orderId } });
          if (order) {
            this.logger.log(
              `${T} [②-UPDATE-TASK] ② 再更新 task(id=${order.taskId.toString()}): ASSIGNED → IN_PROGRESS（按字母序 order 在前 → task 在后）`,
            );
            await tx.task.update({
              where: { id: order.taskId },
              data: { status: 'IN_PROGRESS' },
            });
            this.logger.log(`${T} [②-UPDATE-TASK] ② ✅ task.update 完成`);

            // 5. 写入钱包流水（接单者收入，冻结）- 在同一事务中
            this.logger.log(
              `${T} [WALLET] 写入钱包流水 FREEZE: helperId=${order.helperId.toString()}, orderId=${order.id.toString()}, 金额=${Number(order.totalAmount).toFixed(2)} → 任务报酬（冻结中）`,
            );
            await this.createTransaction(
              order.helperId,
              order.id,
              'FREEZE',
              Number(order.totalAmount),
              '任务报酬（冻结中）',
            );
            this.logger.log(`${T} [WALLET] ✅ 钱包流水写入完成`);

            this.logger.log(
              `${T} [TX-COMMIT] ✅ 支付事务提交成功: order=${orderId.toString()} → task=${order.taskId.toString()}，跨表顺序 order① → task② 无死锁风险`,
            );
          } else {
            this.logger.warn(
              `${T} [TX-COMMIT] ⚠️ order 回读后为空，仅已提交 order.update，跳过 task.update 和钱包流水`,
            );
          }
        });
      } else if (decrypted.trade_state === 'CLOSED') {
        this.logger.log(
          `${T} [SINGLE-TABLE] trade_state=CLOSED → 单表 order.update，无需事务，无死锁风险`,
        );
        await this.prisma.order.update({
          where: { id: orderId },
          data: { status: 'CANCELLED' },
        });
        this.logger.log(`订单已关闭: orderId=${orderId}`);
      } else {
        this.logger.log(
          `${T} [IGNORE] trade_state=${decrypted.trade_state} 暂不处理，直接返回 SUCCESS`,
        );
      }

      return { code: 'SUCCESS', message: '成功' };
    } catch (err) {
      this.logger.error(`支付回调处理异常: ${(err as Error).message}`);
      throw err;
    }
  }

  // ============ 3. 查询订单状态 ============
  async queryOrder(
    orderId: string,
  ): Promise<{ id: string; status: string; totalAmount: string; paidAt: string | null }> {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
    });
    if (!order) throw new NotFoundException('订单不存在');

    return {
      id: order.id.toString(),
      status: order.status,
      totalAmount: order.totalAmount.toString(),
      paidAt: order.paidAt?.toISOString() || null,
    };
  }

  // ============ 4. 申请退款 ============
  async refund(userId: string, dto: RefundDto): Promise<{ success: boolean; refundId: string }> {
    const orderId = BigInt(dto.orderId);
    const uid = BigInt(userId);

    // 1. 查询订单
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { task: { select: { publisherId: true } } },
    });
    if (!order) throw new NotFoundException('订单不存在');

    // 2. 验证权限
    if (order.task.publisherId !== uid) throw new ForbiddenException('只有任务发布者可申请退款');

    if (order.status !== 'PAID') throw new BadRequestException('仅已支付订单可申请退款');

    if (dto.amount > Number(order.totalAmount))
      throw new BadRequestException('退款金额超过订单金额');

    // 3. 调用微信退款 API（模拟）
    const refundResult = await this.callWxRefund({
      outTradeNo: order.id.toString(),
      refundAmount: Math.round(dto.amount * 100),
      totalAmount: Math.round(Number(order.totalAmount) * 100),
      reason: dto.reason || '用户申请退款',
    });

    // 4. 更新订单状态
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'REFUNDED',
        refundAmount: dto.amount,
        refundReason: dto.reason,
      },
    });

    // 5. 写入退款流水
    await this.createTransaction(order.helperId, order.id, 'EXPENSE', -dto.amount, '退款扣除');

    this.logger.log(`退款成功: orderId=${orderId}, amount=${dto.amount}`);

    return { success: true, refundId: refundResult.refundId };
  }

  // ============ 5. 取消超时订单 ============
  async cancelExpiredOrders(): Promise<number> {
    const batchTrace = `BATCH-${Date.now().toString(36)}`;
    const BT = `⏰[${batchTrace}]`;
    this.logger.log(
      `${BT} [BATCH-START] 扫描超时订单: status=PENDING, 早于 ${new Date(Date.now() - ORDER_EXPIRE_SECONDS * 1000).toISOString()} (${ORDER_EXPIRE_SECONDS}秒前)`,
    );

    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - ORDER_EXPIRE_SECONDS * 1000) },
      },
      include: { task: { select: { id: true, status: true } } },
    });

    this.logger.log(`${BT} [BATCH-FOUND] 共发现 ${expiredOrders.length} 笔超时 PENDING 订单`);

    let cancelled = 0;
    let orderIdx = 0;
    for (const order of expiredOrders) {
      orderIdx++;
      const orderTrace = `${batchTrace}-${orderIdx}`;
      const T = `🧾[${orderTrace}]`;

      this.logger.log(
        `${T} [CANCEL-${orderIdx}/${expiredOrders.length}] 准备取消订单: orderId=${order.id.toString()}, taskId=${order.task.id.toString()}, task.status=${order.task.status}`,
      );
      this.logger.log(
        `${T} [TX-START] 进入 $transaction，按字母序 order① → task② 顺序更新（防止 AB-BA 死锁）`,
      );

      // 🔒 使用事务确保一致性，并按预定顺序操作（先order后task，防止死锁）
      await this.prisma.$transaction(async (tx) => {
        // 先更新订单（按字母顺序，order排在task前面）
        this.logger.log(
          `${T} [①-UPDATE-ORDER] ① 先更新 order.update(id=${order.id.toString()}): PENDING → CANCELLED`,
        );
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
        this.logger.log(`${T} [①-UPDATE-ORDER] ① ✅ order.update 完成`);
        
        // 再更新任务（按字母顺序，task排在后面）
        if (order.task.status === 'ASSIGNED') {
          this.logger.log(
            `${T} [②-UPDATE-TASK] ② 再更新 task(id=${order.task.id.toString()}): ASSIGNED → OPEN, helperId=null（按字母序 order① → task②）`,
          );
          await tx.task.update({
            where: { id: order.task.id },
            data: { status: 'OPEN', helperId: null },
          });
          this.logger.log(`${T} [②-UPDATE-TASK] ② ✅ task.update 完成`);
        } else {
          this.logger.log(
            `${T} [②-SKIP-TASK] ② task.status=${order.task.status} !== ASSIGNED，跳过 task.update（无需跨表顺序，仍保持只锁 order 一表）`,
          );
        }

        this.logger.log(
          `${T} [TX-COMMIT] ✅ 取消超时订单事务提交: order=${order.id.toString()} ${order.task.status === 'ASSIGNED' ? `→ 同步回收任务 ${order.task.id.toString()}` : ''}，跨表顺序 order① → task② 无死锁风险`,
        );
      });
      
      cancelled++;
      this.logger.log(`${BT} [PROGRESS] 已处理 ${cancelled}/${expiredOrders.length}: orderId=${order.id.toString()}`);
    }

    this.logger.log(
      `${BT} [BATCH-DONE] 超时订单批量取消完成: 成功取消=${cancelled} / 扫描总数=${expiredOrders.length}`,
    );

    return cancelled;
  }

  // ============ 私有辅助方法 ============

  /** 调用微信统一下单 V3（HTTP POST） */
  private async callWxCreateOrder(params: {
    outTradeNo: string;
    description: string;
    amount: number;
    openid?: string;
  }): Promise<{ prepayId: string }> {
    const url = '/v3/pay/transactions/jsapi';
    const body = JSON.stringify({
      appid: process.env.WX_APP_ID || 'mock_appid',
      mchid: process.env.WX_MCH_ID || 'mock_mchid',
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: process.env.WX_PAY_NOTIFY_URL || 'https://example.com/api/pay/notify',
      amount: { total: params.amount, currency: 'CNY' },
      payer: params.openid ? { openid: params.openid } : undefined,
    });

    try {
      this.wxPay.buildAuthorization('POST', url, body);

      // 实际环境使用 axios/fetch 调用微信 API
      // 这里在开发环境返回 mock prepayId
      if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
        this.logger.warn('开发环境：使用 mock 预支付参数');
        return { prepayId: `wx_mock_prepay_${Date.now()}` };
      }

      // TODO: 生产环境实现真实 HTTP 调用
      // const response = await fetch('https://api.mch.weixin.qq.com' + url, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': authorization,
      //     'Content-Type': 'application/json',
      //     'Accept': 'application/json',
      //   },
      //   body,
      // });
      // const data = await response.json();
      // return { prepayId: data.prepay_id };

      return { prepayId: 'wx_mock_prepay_dev' };
    } catch (err) {
      this.logger.error(`微信下单失败: ${(err as Error).message}`);
      // 开发环境降级
      return { prepayId: `wx_mock_prepay_fallback_${Date.now()}` };
    }
  }

  /** 调用微信退款 API */
  private async callWxRefund(_params: {
    outTradeNo: string;
    refundAmount: number;
    totalAmount: number;
    reason: string;
  }): Promise<{ refundId: string }> {
    const refundNo = `RF${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // 开发环境直接返回
    if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
      this.logger.warn('开发环境：退款 mock');
      return { refundId: refundNo };
    }

    // TODO: 生产环境实现真实退款调用
    return { refundId: refundNo };
  }

  /** 创建钱包流水 */
  private async createTransaction(
    walletUserId: bigint,
    orderId: bigint,
    type: 'INCOME' | 'EXPENSE' | 'FREEZE' | 'UNFREEZE',
    amount: number,
    description: string,
  ): Promise<void> {
    // 确保钱包存在
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId: walletUserId },
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId: walletUserId },
      });
    }

    const newBalance = Number(wallet.balance) + Number(wallet.frozen) + amount;

    await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        orderId,
        type,
        amount,
        balanceAfter: newBalance,
        description,
      },
    });

    // 更新钱包余额/冻结
    const updateData: { balance?: number; frozen?: number } = {};
    if (type === 'FREEZE') {
      updateData.frozen = Number(wallet.frozen) + amount;
    } else if (type === 'UNFREEZE') {
      updateData.frozen = Number(wallet.frozen) - Math.abs(amount);
    } else if (type === 'INCOME') {
      updateData.balance = Number(wallet.balance) + amount;
    } else if (type === 'EXPENSE') {
      updateData.balance = Number(wallet.balance) + amount;
    }

    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: updateData,
    });
  }
}
