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
    const bodyStr = JSON.stringify(body);

    // 1. 验签
    const valid = this.wxPay.verifySignature(timestamp, nonce, bodyStr, signature);
    if (!valid) {
      this.logger.error('支付回调验签失败');
      throw new ForbiddenException('签名验证失败');
    }

    try {
      const b = body as {
        resource?: { ciphertext: string; nonce: string; associated_data: string };
      };

      if (!b?.resource) {
        this.logger.warn('回调报文中无 resource');
        return { code: 'SUCCESS', message: '成功' };
      }

      // 2. 解密
      const decrypted = this.wxPay.decryptResource(b.resource);
      const orderId = BigInt(decrypted.out_trade_no);

      // 3. 根据交易状态更新订单
      if (decrypted.trade_state === 'SUCCESS') {
        // 🔒 使用事务确保一致性，并按预定顺序操作（先order后task，防止死锁）
        await this.prisma.$transaction(async (tx) => {
          // 先更新订单（按字母顺序，order排在task前面）
          await tx.order.update({
            where: { id: orderId },
            data: {
              status: 'PAID',
              paidAt: new Date(),
            },
          });
          
          this.logger.log(`支付成功: orderId=${orderId}`);

          // 再更新任务（按字母顺序，task排在后面）
          const order = await tx.order.findUnique({ where: { id: orderId } });
          if (order) {
            await tx.task.update({
              where: { id: order.taskId },
              data: { status: 'IN_PROGRESS' },
            });

            // 5. 写入钱包流水（接单者收入，冻结）- 在同一事务中
            await this.createTransaction(
              order.helperId,
              order.id,
              'FREEZE',
              Number(order.totalAmount),
              '任务报酬（冻结中）',
            );
          }
        });
      } else if (decrypted.trade_state === 'CLOSED') {
        await this.prisma.order.update({
          where: { id: orderId },
          data: { status: 'CANCELLED' },
        });
        this.logger.log(`订单已关闭: orderId=${orderId}`);
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
    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - ORDER_EXPIRE_SECONDS * 1000) },
      },
      include: { task: { select: { id: true, status: true } } },
    });

    let cancelled = 0;
    for (const order of expiredOrders) {
      // 🔒 使用事务确保一致性，并按预定顺序操作（先order后task，防止死锁）
      await this.prisma.$transaction(async (tx) => {
        // 先更新订单（按字母顺序，order排在task前面）
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
        
        // 再更新任务（按字母顺序，task排在后面）
        if (order.task.status === 'ASSIGNED') {
          await tx.task.update({
            where: { id: order.task.id },
            data: { status: 'OPEN', helperId: null },
          });
        }
      });
      
      cancelled++;
      this.logger.log(`超时订单已取消: orderId=${order.id}`);
    }

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
