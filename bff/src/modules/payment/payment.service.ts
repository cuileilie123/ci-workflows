import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WxPayUtil } from './wx-pay.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { RefundDto } from './dto/refund.dto';
import { ProfitSharingService } from '../admin/profit-sharing/profit-sharing.service';
import { FinanceSettingsService } from '../admin/finance-settings/finance-settings.service';
import { generateUniqueOrderNo } from './order-no.util';
import { MetricsService } from '../../common/metrics.service';

const ORDER_EXPIRE_SECONDS = 900; // 15 分钟

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wxPay: WxPayUtil,
    private readonly profitSharing: ProfitSharingService,
    private readonly metrics: MetricsService,
    private readonly financeSettings: FinanceSettingsService,
  ) {}

  // ============ 1. 创建支付订单 ============
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<{
    orderId: string;
    orderNo: string;
    payParams: ReturnType<WxPayUtil['signForFrontend']>;
  }> {
    const taskId = BigInt(dto.taskId);
    const uid = BigInt(userId);
    this.logger.log(
      `[PAY] [LOG-PO-001] createOrder 入口: userId=${userId}, taskId=${taskId.toString()}`,
    );

    // 1. 查询任务
    this.logger.log(`[PAY] [LOG-PO-002] 查询任务: taskId=${taskId.toString()}`);
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      this.logger.warn(`[PAY] [LOG-PO-003] ❌ 任务不存在: taskId=${taskId.toString()}`);
      throw new NotFoundException('任务不存在');
    }
    this.logger.log(
      `[PAY] [LOG-PO-004] 任务存在: taskId=${taskId.toString()}, status=${task.status}, ` +
        `publisherId=${task.publisherId.toString()}, helperId=${task.helperId?.toString() ?? '(无)'}, price=¥${task.price}`,
    );
    if (task.status !== 'ASSIGNED') {
      this.logger.warn(
        `[PAY] [LOG-PO-005] ❌ 任务状态异常,仅已接单可支付: taskId=${taskId.toString()}, status=${task.status}`,
      );
      throw new ConflictException('任务状态异常，仅已接单状态可支付');
    }
    if (!task.helperId) {
      this.logger.warn(`[PAY] [LOG-PO-006] ❌ 任务未分配接单者: taskId=${taskId.toString()}`);
      throw new ConflictException('任务尚未分配接单者');
    }

    // 只有发布者能创建支付订单
    if (task.publisherId !== uid) {
      this.logger.warn(
        `[PAY] [LOG-PO-007] ❌ 权限拒绝: 只有发布者可发起支付; task.publisherId=${task.publisherId.toString()}, caller.uid=${userId}`,
      );
      throw new ForbiddenException('只有任务发布者可发起支付');
    }

    // 检查是否已有未完成的普通订单（排除补差订单）
    this.logger.log(`[PAY] [LOG-PO-008] 查询已有未完成的普通订单: taskId=${taskId.toString()}`);
    const existingOrder = await this.prisma.order.findFirst({
      where: { taskId, isSupplement: false },
      orderBy: { createdAt: 'desc' },
    });
    if (existingOrder && !['CANCELLED', 'REFUNDED'].includes(existingOrder.status)) {
      this.logger.warn(
        `[PAY] [LOG-PO-009] ❌ 任务已有未完成订单,拒绝重复创建: ` +
          `taskId=${taskId.toString()}, existingOrderId=${existingOrder.id.toString()}, status=${existingOrder.status}`,
      );
      throw new ConflictException('该任务已有未完成的订单');
    }
    this.logger.log(
      `[PAY] [LOG-PO-010] 订单幂等检查通过: existingOrder=${existingOrder ? `id=${existingOrder.id.toString()},status=${existingOrder.status}(可重开)` : '无历史订单'}`,
    );

    // 2. 按分账规则计算平台抽成
    const sharing = await this.profitSharing.calculate(task.price, task.categoryId);
    this.logger.log(
      `创建订单: taskId=${task.id.toString()} 命中规则 ruleId=${sharing.ruleId}, ` +
        `platformRate=${(sharing.platformRate * 100).toFixed(2)}%, helperRate=${(sharing.helperRate * 100).toFixed(2)}%, ` +
        `platformFee=${sharing.platformFee}, helperAmount=${sharing.helperAmount}`,
    );

    // 3. 创建/复用订单（生成唯一订单号）
    this.logger.log(`[PAY] [LOG-PO-011] 开始生成唯一订单号并创建订单: taskId=${taskId.toString()}, price=¥${task.price}`);
    const orderNo = await generateUniqueOrderNo(async (no) => {
      const existing = await this.prisma.order.findUnique({ where: { orderNo: no } });
      return !!existing;
    });
    this.logger.log(`[PAY] [LOG-PO-012] 生成唯一订单号: orderNo=${orderNo}`);
    const order = await this.prisma.order.create({
      data: {
        orderNo,
        taskId,
        helperId: task.helperId,
        totalAmount: task.price,
        platformFee: sharing.platformFee,
        status: 'PENDING',
      },
    });
    this.logger.log(
      `[PAY] [LOG-PO-013] 订单已写入 DB: orderId=${order.id.toString()}, orderNo=${order.orderNo}, status=PENDING, price=¥${order.totalAmount}`,
    );

    // 3. 调用微信统一下单 V3（模拟，实际需要 HTTP 请求）
    this.logger.log(
      `[PAY] [LOG-PO-014] 开始调用微信统一下单: outTradeNo=${order.id.toString()}, ` +
        `description="${task.title}", amount_fen=${Math.round(Number(task.price) * 100)}`,
    );
    const wxOrder = await this.callWxCreateOrder({
      outTradeNo: order.id.toString(),
      description: task.title,
      amount: Math.round(Number(task.price) * 100),
      openid: (await this.prisma.user.findUnique({ where: { id: uid } }))?.openid,
    });

    // 4. 返回预支付参数（二次签名给前端）
    this.logger.log(`[PAY] [LOG-PO-015] 微信统一下单返回 prepayId,调用 signForFrontend 生成前端二次签名`);
    const payParams = this.wxPay.signForFrontend(wxOrder.prepayId);

    this.logger.log(
      `[PAY] [LOG-PO-016] ✅ createOrder 完成: orderId=${order.id}, orderNo=${order.orderNo}, ` +
        `prepayId.preview=${wxOrder.prepayId.slice(0, 16)}...`,
    );

    return {
      orderId: order.id.toString(),
      orderNo: order.orderNo,
      payParams,
    };
  }

  // ============ 1b. 补差订单支付 ============
  /**
   * 发布者支付改价补差订单
   * 流程：查找 PENDING 补差订单 → 调用微信统一下单 → 返回预支付参数
   */
  async createSupplementOrder(
    userId: string,
    taskId: string,
  ): Promise<{ orderId: string; payParams: ReturnType<WxPayUtil['signForFrontend']> }> {
    const tid = BigInt(taskId);
    const uid = BigInt(userId);
    this.logger.log(
      `[PAY] [LOG-PS-001] createSupplementOrder 入口: userId=${userId}, taskId=${taskId}`,
    );

    this.logger.log(`[PAY] [LOG-PS-002] 查询任务: taskId=${taskId}`);
    const task = await this.prisma.task.findUnique({ where: { id: tid } });
    if (!task) {
      this.logger.warn(`[PAY] [LOG-PS-003] ❌ 任务不存在: taskId=${taskId}`);
      throw new NotFoundException('任务不存在');
    }
    if (task.publisherId !== uid) {
      this.logger.warn(
        `[PAY] [LOG-PS-004] ❌ 权限拒绝: 只有发布者可支付补差订单; task.publisherId=${task.publisherId.toString()}, caller=${userId}`,
      );
      throw new ForbiddenException('只有任务发布者可支付补差订单');
    }

    // 查找 PENDING 状态的补差订单
    this.logger.log(`[PAY] [LOG-PS-005] 查询待支付补差订单: taskId=${taskId}, status=PENDING, isSupplement=true`);
    const supplementOrder = await this.prisma.order.findFirst({
      where: { taskId: tid, isSupplement: true, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!supplementOrder) {
      this.logger.warn(
        `[PAY] [LOG-PS-006] ❌ 未找到待支付的补差订单: taskId=${taskId}`,
      );
      throw new NotFoundException('未找到待支付的补差订单');
    }
    this.logger.log(
      `[PAY] [LOG-PS-007] 找到待支付补差订单: orderId=${supplementOrder.id.toString()}, ` +
        `amount=¥${supplementOrder.totalAmount}, isSupplement=true, status=${supplementOrder.status}`,
    );

    // 调用微信统一下单
    this.logger.log(
      `[PAY] [LOG-PS-008] 调用微信统一下单: outTradeNo=${supplementOrder.id.toString()}, ` +
        `description="补差支付-${task.title}", amount_fen=${Math.round(Number(supplementOrder.totalAmount) * 100)}`,
    );
    const wxOrder = await this.callWxCreateOrder({
      outTradeNo: supplementOrder.id.toString(),
      description: `补差支付-${task.title}`,
      amount: Math.round(Number(supplementOrder.totalAmount) * 100),
      openid: (await this.prisma.user.findUnique({ where: { id: uid } }))?.openid,
    });

    this.logger.log(`[PAY] [LOG-PS-009] 微信统一下单返回,开始 signForFrontend`);
    const payParams = this.wxPay.signForFrontend(wxOrder.prepayId);

    this.logger.log(
      `[PAY] [LOG-PS-010] ✅ 补差订单创建成功: orderId=${supplementOrder.id}, taskId=${taskId}, ` +
        `amount=¥${supplementOrder.totalAmount}, prepayId.preview=${wxOrder.prepayId.slice(0, 16)}...`,
    );

    return {
      orderId: supplementOrder.id.toString(),
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

        // 先读取订单判断是否为补差订单
        const preOrder = await this.prisma.order.findUnique({
          where: { id: orderId },
          select: { id: true, isSupplement: true, taskId: true },
        });

        if (preOrder?.isSupplement) {
          // ===== 补差订单回调：订单 PAID + 任务回到 previousStatus + 冻结新增差额给接单者 =====
          this.logger.log(
            `${T} [SUPPLEMENT] 检测到补差订单 orderId=${orderId.toString()}，执行补差回调流程`,
          );

          // 读取补差订单详情 + 改价单 previousStatus
          const supplementOrder = await this.prisma.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              taskId: true,
              helperId: true,
              totalAmount: true,
              platformFee: true,
            },
          });

          const priceMod = await this.prisma.priceModification.findFirst({
            where: { taskId: preOrder.taskId, status: 'CONFIRMED' },
            orderBy: { createdAt: 'desc' },
            select: { previousStatus: true },
          });
          const returnStatus = priceMod?.previousStatus || 'ASSIGNED';

          await this.prisma.$transaction(async (tx) => {
            // 1. 更新补差订单为 PAID
            await tx.order.update({
              where: { id: orderId },
              data: { status: 'PAID', paidAt: new Date() },
            });
            this.logger.log(`${T} [SUPPLEMENT] ✅ 补差订单已标记 PAID`);

            // 2. 任务回到 previousStatus（ASSIGNED 或 IN_PROGRESS），保留 helperId
            await tx.task.update({
              where: { id: preOrder.taskId },
              data: { status: returnStatus },
            });
            this.logger.log(
              `${T} [SUPPLEMENT] ✅ 任务 #${preOrder.taskId.toString()} 已回到 ${returnStatus}（补差完成，接单者保留）`,
            );
          });
          this.logger.log(`${T} [SUPPLEMENT] ✅ 补差回调事务提交成功`);

          // 3. 冻结补差额中的接单者部分（在事务外执行，与普通订单回调一致）
          if (supplementOrder) {
            const freezeAmount =
              Number(supplementOrder.totalAmount) - Number(supplementOrder.platformFee);
            if (freezeAmount > 0) {
              this.logger.log(
                `${T} [SUPPLEMENT] 冻结补差额给接单者: helperId=${supplementOrder.helperId.toString()}, 冻结=¥${freezeAmount.toFixed(2)}`,
              );
              await this.createTransaction(
                supplementOrder.helperId,
                supplementOrder.id,
                'FREEZE',
                freezeAmount,
                `补差支付-增加冻结（任务 ${supplementOrder.taskId.toString()}）`,
              );
              this.logger.log(`${T} [SUPPLEMENT] ✅ 接单者冻结金额已增加`);
            }
          }
        } else {
          // ===== 普通订单回调：原有流程 =====
          // 🔒 使用事务确保一致性，并按预定顺序操作（先order后task，防止死锁）
          const paidOrderInfo = await this.prisma.$transaction(async (tx) => {
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

              // 5. 按分账规则计算接单者冻结金额（仅冻结接单者应得部分，平台抽成另计）
              const orderWithTask = await tx.order.findUnique({
                where: { id: orderId },
                include: { task: { select: { categoryId: true } } },
              });
              const sharing2 = orderWithTask?.task
                ? await this.profitSharing.calculate(
                    order.totalAmount,
                    orderWithTask.task.categoryId,
                  )
                : null;
              const freezeAmount = sharing2 ? sharing2.helperAmount : Number(order.totalAmount);
              this.logger.log(
                `${T} [WALLET] 写入钱包流水 FREEZE: helperId=${order.helperId.toString()}, ` +
                  `orderId=${order.id.toString()}, 冻结金额=${freezeAmount.toFixed(2)} (规则 ruleId=${sharing2?.ruleId || 'DEFAULT'}) → 任务报酬（冻结中）, ` +
                  `平台抽成 platformFee=${Number(order.platformFee).toFixed(2)}`,
              );
              await this.createTransaction(
                order.helperId,
                order.id,
                'FREEZE',
                freezeAmount,
                `任务报酬（冻结，规则 ${sharing2?.ruleId || 'DEFAULT'}）`,
              );
              this.logger.log(`${T} [WALLET] ✅ 钱包流水写入完成`);

              this.logger.log(
                `${T} [TX-COMMIT] ✅ 支付事务提交成功: order=${orderId.toString()} → task=${order.taskId.toString()}，跨表顺序 order① → task② 无死锁风险`,
              );
              return {
                orderId: order.id,
                platformFee: Number(order.platformFee),
              };
            } else {
              this.logger.warn(
                `${T} [TX-COMMIT] ⚠️ order 回读后为空，仅已提交 order.update，跳过 task.update 和钱包流水`,
              );
              return null;
            }
          });

          // 6. 分账（事务外，不阻塞订单状态；失败仅记录日志，不影响回调返回）
          // 微信分账要求 transaction_id（来自支付回调）+ 已标记 profit_sharing=true 的订单

          // [LOG-PS-050] 分账触发条件评估（关键节点：排查"为什么没分账"的入口）
          const hasPaidOrderInfo = !!paidOrderInfo;
          const hasTransactionId = !!decrypted.transaction_id;
          const platformFeePositive = paidOrderInfo ? paidOrderInfo.platformFee > 0 : false;
          this.logger.log(
            `${T} [PROFIT-SHARE] 触发条件评估: ` +
              `hasPaidOrderInfo=${hasPaidOrderInfo}, ` +
              `hasTransactionId=${hasTransactionId} (txId=${decrypted.transaction_id ?? '(空)'}), ` +
              `platformFeePositive=${platformFeePositive}` +
              (paidOrderInfo ? ` (platformFee=¥${paidOrderInfo.platformFee.toFixed(2)})` : '') +
              ` → willCall=${hasPaidOrderInfo && hasTransactionId && platformFeePositive}`,
          );

          if (paidOrderInfo && decrypted.transaction_id && paidOrderInfo.platformFee > 0) {
            const shareOutOrderNo = `PS${paidOrderInfo.orderId.toString()}${Date.now().toString(36)}`;

            // [LOG-PS-051] 分账调用前：完整上下文（订单 / 任务 / 接收方 / 金额明细）
            // 优先级：DB(FinanceSettingsService) > env
            const receiverSnapshot = await this.financeSettings.getActiveProfitSharingReceiver();
            this.logger.log(
              `${T} [PROFIT-SHARE] 调用分账: ` +
                `orderId=${paidOrderInfo.orderId.toString()}, ` +
                `transactionId=${decrypted.transaction_id}, ` +
                `outOrderNo(分账单号)=${shareOutOrderNo}, ` +
                `platformFee=¥${paidOrderInfo.platformFee.toFixed(2)}, ` +
                `profit_sharing_enabled=${receiverSnapshot.enabled}, ` +
                `receiver_mch_id=${receiverSnapshot.mchId || '(空)'}`,
            );

            const shareResult = await this.callWxProfitSharing({
              transactionId: decrypted.transaction_id,
              outOrderNo: shareOutOrderNo,
              platformFee: paidOrderInfo.platformFee,
            }).catch((err: unknown) => {
              // [LOG-PS-052] 分账调用异常（兜底 catch，防止异常影响回调响应）
              this.logger.error(
                `${T} [PROFIT-SHARE] ❌ 分账调用异常（兜底 catch）: outOrderNo=${shareOutOrderNo}, ` +
                  `orderId=${paidOrderInfo.orderId.toString()}, ` +
                  `transactionId=${decrypted.transaction_id}, ` +
                  `error=${(err as Error).message}`,
              );
              this.logger.error(
                `${T} [PROFIT-SHARE] 异常堆栈: ${(err as Error).stack ?? '(无)'}`,
              );
              this.logger.error(
                `${T} [PROFIT-SHARE] 📌 影响: 订单已 PAID 不回滚，可由对账任务重试分账`,
              );
              return { shareOrderId: '', success: false };
            });

            // [LOG-PS-053] 分账结果汇总（关键节点：成功/失败的最终判定点）
            if (shareResult.success) {
              this.logger.log(
                `${T} [PROFIT-SHARE] ✅ 分账成功: orderId=${paidOrderInfo.orderId.toString()}, ` +
                  `outOrderNo=${shareOutOrderNo}, ` +
                  `shareOrderId=${shareResult.shareOrderId}, ` +
                  `platformFee=¥${paidOrderInfo.platformFee.toFixed(2)}, ` +
                  `transactionId=${decrypted.transaction_id}`,
              );
              this.metrics.recordSuccess(receiverSnapshot.mchId);
            } else {
              this.logger.warn(
                `${T} [PROFIT-SHARE] ⚠️ 分账未完成: orderId=${paidOrderInfo.orderId.toString()}, ` +
                  `outOrderNo=${shareOutOrderNo}, ` +
                  `platformFee=¥${paidOrderInfo.platformFee.toFixed(2)}, ` +
                  `shareOrderId="${shareResult.shareOrderId || '(空)'}", ` +
                  `订单状态保持 PAID，可由对账任务重试`,
              );
              this.metrics.recordFail(receiverSnapshot.mchId);
            }
          } else {
            // [LOG-PS-054] 分账未触发（关键节点：排查"为什么没分账"的辅助信息）
            this.logger.log(
              `${T} [PROFIT-SHARE] 分账未触发（不满足条件）: ` +
                `orderId=${paidOrderInfo?.orderId.toString() ?? '(无 paidOrderInfo)'}, ` +
                `原因=${!paidOrderInfo ? '事务返回 null（订单回读失败）' : !decrypted.transaction_id ? '回调中无 transaction_id（罕见，可能非支付渠道）' : 'platformFee<=0（免佣订单）'}, ` +
                `资金保留在主商户号 WX_MCH_ID`,
            );
          }
        }
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
  async queryOrder(orderId: string): Promise<{
    id: string;
    orderNo: string;
    taskId: string;
    status: string;
    totalAmount: string;
    paidAt: string | null;
    createdAt?: string;
    refundAmount?: string | null;
    taskTitle?: string;
    taskAddress?: string;
    publisherId?: string;
    helperId?: string;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            address: true,
            publisherId: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');

    return {
      id: order.id.toString(),
      orderNo: order.orderNo,
      taskId: order.taskId.toString(),
      status: order.status,
      totalAmount: order.totalAmount.toString(),
      paidAt: order.paidAt?.toISOString() || null,
      createdAt: order.createdAt?.toISOString() || undefined,
      refundAmount: order.refundAmount ? order.refundAmount.toString() : null,
      taskTitle: order.task?.title,
      taskAddress: order.task?.address || undefined,
      publisherId: order.task?.publisherId.toString(),
      helperId: order.helperId?.toString(),
    };
  }

  // ============ 3a. 查询用户订单列表 ============
  async getUserOrders(
    userId: string,
    status?: string,
    page?: number,
    pageSize?: number,
  ): Promise<
    {
      id: string;
      orderNo: string;
      taskId: string;
      status: string;
      totalAmount: string;
      paidAt: string | null;
      createdAt?: string;
      refundAmount?: string | null;
      taskTitle?: string;
      taskAddress?: string;
      publisherId?: string;
      helperId?: string;
    }[]
  > {
    const uid = BigInt(userId);
    const take = Math.min(pageSize ?? 20, 100);
    const skip = ((page ?? 1) - 1) * take;

    const orders = await this.prisma.order.findMany({
      where: {
        OR: [{ helperId: uid }, { task: { publisherId: uid } }],
        ...(status
          ? {
              status: status as
                'PENDING' | 'PAID' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED',
            }
          : {}),
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            address: true,
            publisherId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });

    return orders.map((order) => ({
      id: order.id.toString(),
      orderNo: order.orderNo,
      taskId: order.taskId.toString(),
      status: order.status,
      totalAmount: order.totalAmount.toString(),
      paidAt: order.paidAt?.toISOString() || null,
      createdAt: order.createdAt?.toISOString() || undefined,
      refundAmount: order.refundAmount ? order.refundAmount.toString() : null,
      taskTitle: order.task?.title,
      taskAddress: order.task?.address || undefined,
      publisherId: order.task?.publisherId.toString(),
      helperId: order.helperId?.toString(),
    }));
  }

  // ============ 3b. 取消待支付订单 ============
  async cancelOrder(userId: string, orderId: string): Promise<{ success: boolean }> {
    const oid = BigInt(orderId);
    const uid = BigInt(userId);
    this.logger.log(
      `[PAY] [LOG-PC-001] cancelOrder 入口: userId=${userId}, orderId=${orderId}`,
    );

    // 1. 查询订单（带关联任务以校验权限）
    this.logger.log(`[PAY] [LOG-PC-002] 查询订单: orderId=${orderId}(带关联 task 信息)`);
    const order = await this.prisma.order.findUnique({
      where: { id: oid },
      include: { task: { select: { publisherId: true, id: true, status: true } } },
    });
    if (!order) {
      this.logger.warn(`[PAY] [LOG-PC-003] ❌ 订单不存在: orderId=${orderId}`);
      throw new NotFoundException('订单不存在');
    }
    this.logger.log(
      `[PAY] [LOG-PC-004] 订单存在: orderId=${order.id.toString()}, status=${order.status}, ` +
        `orderNo=${order.orderNo}, task.status=${order.task.status}, task.publisherId=${order.task.publisherId.toString()}`,
    );

    // 2. 权限校验：只有发布者可取消
    if (order.task.publisherId !== uid) {
      this.logger.warn(
        `[PAY] [LOG-PC-005] ❌ 权限拒绝: 只有发布者可取消订单; ` +
          `task.publisherId=${order.task.publisherId.toString()}, caller=${userId}`,
      );
      throw new ForbiddenException('只有任务发布者可取消订单');
    }
    this.logger.log(`[PAY] [LOG-PC-006] 权限通过: userId=${userId} 确认为任务发布者`);

    // 3. 状态校验：只有 PENDING 状态可取消
    if (order.status !== 'PENDING') {
      this.logger.warn(
        `[PAY] [LOG-PC-007] ❌ 订单状态不允许取消: orderId=${orderId}, actual=${order.status}, expected=PENDING`,
      );
      throw new ConflictException(`订单状态为 ${order.status}，无法取消（仅待支付订单可取消）`);
    }
    this.logger.log(`[PAY] [LOG-PC-008] 状态校验通过: status=PENDING, 允许取消`);

    // 4. 事务内更新：order → task（按字母序保持一致，防止死锁）
    const willRollbackTask = order.task.status === 'ASSIGNED';
    this.logger.log(
      `[PAY] [LOG-PC-009] 开始 $transaction(按字母序 order→task): order→CANCELLED, task=${willRollbackTask ? 'ASSIGNED→OPEN 清 helperId' : '不改动'}`,
    );
    await this.prisma.$transaction(async (tx) => {
      this.logger.log(`[PAY] [LOG-PC-010] [T-X-1/2] order.update status→CANCELLED: orderId=${orderId}`);
      await tx.order.update({
        where: { id: oid },
        data: { status: 'CANCELLED' },
      });

      // 若任务处于 ASSIGNED 状态，回滚为 OPEN 并清空 helperId
      if (willRollbackTask) {
        this.logger.log(
          `[PAY] [LOG-PC-011] [T-X-2/2] task.update status→OPEN + helperId→null: taskId=${order.task.id.toString()}`,
        );
        await tx.task.update({
          where: { id: order.task.id },
          data: { status: 'OPEN', helperId: null },
        });
      }
    });
    this.logger.log(`[PAY] [LOG-PC-012] $transaction 提交完成`);

    this.logger.log(
      `[PAY] [LOG-PC-013] ✅ cancelOrder 成功: orderId=${orderId}, userId=${userId}, ` +
        `taskRollback=${willRollbackTask ? '是(ASSIGNED→OPEN)' : '否'}`,
    );
    return { success: true };
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

  // ============ 4b. 申请退款（24h内原路退回） ============
  /**
   * 用户确认退款申请 → 创建 RefundRequest（PENDING）→ 订单状态 REFUND_PENDING
   * 定时任务 processPendingRefunds 会在每分钟扫描并调用微信退款 API
   * 微信退款到账时间通常 1-24h（储蓄卡 1-3 工作日，零钱即时）
   */
  async requestRefund(
    userId: string,
    orderId: string,
    reason?: string,
  ): Promise<{
    success: boolean;
    refundRequestId: string;
    message: string;
  }> {
    const oid = BigInt(orderId);
    const uid = BigInt(userId);

    // 1. 查询订单
    const order = await this.prisma.order.findUnique({
      where: { id: oid },
      include: { task: { select: { publisherId: true, title: true } } },
    });
    if (!order) throw new NotFoundException('订单不存在');

    // 2. 验证权限
    if (order.task.publisherId !== uid) {
      throw new ForbiddenException('只有任务发布者可申请退款');
    }

    // 3. 状态校验：仅 PAID 或 IN_PROGRESS 订单可申请退款
    if (!['PAID', 'IN_PROGRESS'].includes(order.status)) {
      throw new BadRequestException(`当前订单状态(${order.status})不可申请退款`);
    }

    // 4. 检查是否已有退款申请
    const existing = await this.prisma.refundRequest.findUnique({
      where: { orderId: oid },
    });
    if (existing && ['PENDING', 'PROCESSING'].includes(existing.status)) {
      throw new ConflictException('该订单已有进行中的退款申请');
    }

    // 5. 计算退款金额（全额退款，扣除已记录的部分退款）
    const alreadyRefunded = order.refundAmount ? Number(order.refundAmount) : 0;
    const refundAmount = Number(order.totalAmount) - alreadyRefunded;
    if (refundAmount <= 0) {
      throw new BadRequestException('订单已全额退款，无可退金额');
    }

    // 6. 创建退款申请 + 更新订单状态
    const refundRequest = await this.prisma.$transaction(async (tx) => {
      const rr = await tx.refundRequest.create({
        data: {
          orderId: oid,
          userId: uid,
          amount: refundAmount,
          reason: reason || '用户申请退款',
          status: 'PENDING',
        },
      });

      await tx.order.update({
        where: { id: oid },
        data: { status: 'REFUND_PENDING' },
      });

      return rr;
    });

    this.logger.log(
      `退款申请已创建: refundRequestId=${refundRequest.id}, orderId=${orderId}, amount=¥${refundAmount}, 任务="${order.task.title}"`,
    );

    return {
      success: true,
      refundRequestId: refundRequest.id.toString(),
      message: '退款申请已提交，预计24小时内原路退回到您的微信钱包或银行卡',
    };
  }

  /** 查询退款状态 */
  async getRefundStatus(
    userId: string,
    orderId: string,
  ): Promise<{
    status: string;
    amount: number;
    requestedAt: string | null;
    processedAt: string | null;
    refundId: string | null;
    failReason: string | null;
  }> {
    const oid = BigInt(orderId);
    const uid = BigInt(userId);

    const order = await this.prisma.order.findUnique({
      where: { id: oid },
      include: { task: { select: { publisherId: true } }, refundRequest: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.task.publisherId !== uid) {
      throw new ForbiddenException('无权查看此订单退款状态');
    }

    if (!order.refundRequest) {
      return {
        status: 'NONE',
        amount: 0,
        requestedAt: null,
        processedAt: null,
        refundId: null,
        failReason: null,
      };
    }

    return {
      status: order.refundRequest.status,
      amount: Number(order.refundRequest.amount),
      requestedAt: order.refundRequest.requestedAt.toISOString(),
      processedAt: order.refundRequest.processedAt?.toISOString() ?? null,
      refundId: order.refundRequest.refundId,
      failReason: order.refundRequest.failReason,
    };
  }

  // ============ 5. 取消超时订单（每分钟执行一次） ============
  @Cron(CronExpression.EVERY_MINUTE)
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
      this.logger.log(
        `${BT} [PROGRESS] 已处理 ${cancelled}/${expiredOrders.length}: orderId=${order.id.toString()}`,
      );
    }

    this.logger.log(
      `${BT} [BATCH-DONE] 超时订单批量取消完成: 成功取消=${cancelled} / 扫描总数=${expiredOrders.length}`,
    );

    return cancelled;
  }

  // ============ 6. 处理待退款申请（每分钟执行） ============
  /**
   * 扫描 PENDING 状态的退款申请 → 调用微信退款 API → 更新为 COMPLETED
   * 微信退款到账时间：零钱即时，储蓄卡 1-3 工作日，信用卡 3-5 工作日
   * 此任务负责发起退款请求，实际到账由微信支付异步完成
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingRefunds(): Promise<number> {
    const batchTrace = `RF-${Date.now().toString(36)}`;
    const BT = `💰[${batchTrace}]`;

    const pendingRefunds = await this.prisma.refundRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        order: {
          select: { id: true, totalAmount: true, platformFee: true, helperId: true, taskId: true },
        },
      },
      orderBy: { requestedAt: 'asc' },
    });

    if (pendingRefunds.length === 0) return 0;

    this.logger.log(`${BT} [BATCH-START] 发现 ${pendingRefunds.length} 笔待处理退款申请`);

    let processed = 0;
    for (const refund of pendingRefunds) {
      const T = `💰[${batchTrace}-${processed + 1}]`;
      try {
        this.logger.log(
          `${T} 处理退款: refundRequestId=${refund.id}, orderId=${refund.orderId.toString()}, amount=¥${refund.amount}`,
        );

        // 标记为 PROCESSING
        await this.prisma.refundRequest.update({
          where: { id: refund.id },
          data: { status: 'PROCESSING' },
        });

        // 调用微信退款 API
        const refundResult = await this.callWxRefund({
          outTradeNo: refund.orderId.toString(),
          refundAmount: Math.round(Number(refund.amount) * 100),
          totalAmount: Math.round(Number(refund.order.totalAmount) * 100),
          reason: refund.reason || '用户申请退款',
        });

        // 退款成功：更新退款申请 + 订单状态 + 解冻接单者冻结
        await this.prisma.$transaction(async (tx) => {
          // 1. 更新退款申请为 COMPLETED
          await tx.refundRequest.update({
            where: { id: refund.id },
            data: {
              status: 'COMPLETED',
              refundId: refundResult.refundId,
              processedAt: new Date(),
            },
          });

          // 2. 更新订单为 REFUNDED
          await tx.order.update({
            where: { id: refund.orderId },
            data: {
              status: 'REFUNDED',
              refundAmount: Number(refund.amount),
              refundReason: refund.reason,
            },
          });

          // 3. 解冻接单者冻结金额（如果任务已接单）
          if (refund.order.helperId) {
            const helperWallet = await tx.wallet.findUnique({
              where: { userId: refund.order.helperId },
            });
            if (helperWallet) {
              const unfreezeAmount =
                Number(refund.order.totalAmount) - Number(refund.order.platformFee);
              if (unfreezeAmount > 0) {
                const newFrozen = Math.max(0, Number(helperWallet.frozen) - unfreezeAmount);
                await tx.wallet.update({
                  where: { id: helperWallet.id },
                  data: { frozen: newFrozen },
                });
                await tx.transaction.create({
                  data: {
                    walletId: helperWallet.id,
                    orderId: refund.orderId,
                    type: 'UNFREEZE',
                    amount: unfreezeAmount,
                    balanceAfter: Number(helperWallet.balance),
                    description: `退款-解冻（订单 ${refund.orderId.toString()}）`,
                  },
                });
                this.logger.log(`${T} ✅ 接单者冻结解冻 ¥${unfreezeAmount.toFixed(2)}`);
              }
            }
          }

          // 4. 更新任务状态为 CANCELLED
          await tx.task.update({
            where: { id: refund.order.taskId },
            data: { status: 'CANCELLED' },
          });
        });

        processed++;
        this.logger.log(`${T} ✅ 退款处理成功: refundId=${refundResult.refundId}`);
      } catch (err) {
        const errMsg = (err as Error).message;
        this.logger.error(`${T} ❌ 退款处理失败: ${errMsg}`);

        // 标记为 FAILED，可重试
        await this.prisma.refundRequest.update({
          where: { id: refund.id },
          data: {
            status: 'FAILED',
            failReason: errMsg,
            processedAt: new Date(),
          },
        });

        // 订单状态回退为 PAID（允许用户重新申请）
        await this.prisma.order.update({
          where: { id: refund.orderId },
          data: { status: 'PAID' },
        });
      }
    }

    this.logger.log(`${BT} [BATCH-DONE] 退款处理完成: 成功=${processed}/${pendingRefunds.length}`);
    return processed;
  }

  // ============ 7. 处理超时无人接单任务（每分钟执行） ============
  /**
   * 扫描 OPEN 状态且已超过 expireAt 的任务 → 标记为 EXPIRED
   * 用户可在任务详情中看到 EXPIRED 状态并发起退款
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processExpiredTasks(): Promise<number> {
    const now = new Date();
    const expiredTasks = await this.prisma.task.findMany({
      where: {
        status: 'OPEN',
        expireAt: { lt: now },
        deletedAt: null,
      },
      select: { id: true, title: true, expireAt: true },
    });

    if (expiredTasks.length === 0) return 0;

    this.logger.log(`⏰[EXP] 发现 ${expiredTasks.length} 个超时无人接单任务`);

    let expired = 0;
    for (const task of expiredTasks) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'EXPIRED' },
      });

      expired++;
      this.logger.log(
        `⏰[EXP] 任务 #${task.id} "${task.title}" 已标记为 EXPIRED（expireAt=${task.expireAt.toISOString()})`,
      );
    }

    return expired;
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
    // 仅当配置了独立的平台佣金分账接收方时，才在统一下单时标记 profit_sharing=true
    // 微信支付要求：未标记 profit_sharing 的订单不可调用分账接口
    // 优先级：DB(FinanceSettingsService) > env
    const receiver = await this.financeSettings.getActiveProfitSharingReceiver();
    // 主商户号 / AppID 优先从 DB 读取（老板可在财务设置页覆盖 .env），DB 未配置时回落到 env
    const activeMchId = await this.financeSettings.getActiveMainMchId();
    const activeAppId = await this.financeSettings.getActiveAppId();

    // [LOG-PS-001] 统一下单入口：记录是否启用 profit_sharing（决定后续能否分账）
    this.logger.log(
      `[WX-CREATE-ORDER] 入口: outTradeNo=${params.outTradeNo}, amount=¥${(params.amount / 100).toFixed(2)}, ` +
        `openid=${params.openid ? params.openid.slice(0, 8) + '...' : '(无)'}, ` +
        `profit_sharing_enabled=${receiver.enabled}` +
        (receiver.enabled ? `, receiver_mch_id=${receiver.mchId}` : '') +
        `, mchId_source=${activeMchId ? '已配置' : '(空,将用mock)'}, appId_source=${activeAppId ? '已配置' : '(空,将用mock)'}`,
    );

    const body = JSON.stringify({
      appid: activeAppId || 'mock_appid',
      mchid: activeMchId || 'mock_mchid',
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: process.env.WX_PAY_NOTIFY_URL || 'https://example.com/api/pay/notify',
      amount: { total: params.amount, currency: 'CNY' },
      payer: params.openid ? { openid: params.openid } : undefined,
      ...(receiver.enabled ? { profit_sharing: true } : {}),
    });

    // [LOG-PS-002] profit_sharing 标记决策（关键节点：未标记的订单后续无法分账）
    this.logger.log(
      `[WX-CREATE-ORDER] profit_sharing 标记决策: outTradeNo=${params.outTradeNo}, ` +
        `标记结果=${receiver.enabled ? 'true ✅ (订单将可分账)' : '未标记 ❌ (订单不可分账)'}, ` +
        `原因=${receiver.enabled ? `已配置接收方 ${receiver.mchId}` : '未配置分账接收方或 ENABLED=false'}`,
    );

    try {
      // buildAuthorization 的 mchId 来自 env，这里通过 mchIdOverride 让老板可在财务设置页覆盖
      this.wxPay.buildAuthorization('POST', url, body, undefined, undefined, activeMchId);

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
      this.logger.error(
        `[WX-CREATE-ORDER] ❌ 微信下单失败: outTradeNo=${params.outTradeNo}, error=${(err as Error).message}`,
      );
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

  /**
   * 调用微信分账 API（POST /v3/profit-sharing/orders）
   * 将订单的 platformFee 分到独立的平台佣金收款商户号。
   *
   * 前置条件（需在微信商户平台完成一次配置）：
   * 1. 商户号 WX_MCH_ID 已开通"分账"功能
   * 2. 在商户平台添加分账接收方 WX_PROFIT_SHARING_RECEIVER_MCH_ID
   * 3. 统一下单时已传 profit_sharing=true（见 callWxCreateOrder）
   *
   * 注意：分账金额不能超过订单可分账金额（默认为订单总额扣除手续费后），
   * 这里仅分 platformFee，剩余资金自动解冻给商户号 WX_MCH_ID（即原路）。
   *
   * @returns shareOrderId 微信分账单号；失败时返回空字符串，调用方需重试
   */
  private async callWxProfitSharing(params: {
    transactionId: string;
    outOrderNo: string;
    platformFee: number;
  }): Promise<{ shareOrderId: string; success: boolean }> {
    // [LOG-PS-100] 分账调用入口：记录所有关键参数（排查"为什么没分账"的首要依据）
    this.logger.log(
      `[PROFIT-SHARE] 入口: outOrderNo=${params.outOrderNo}, ` +
        `transactionId=${params.transactionId}, ` +
        `platformFee=¥${params.platformFee.toFixed(2)} (=${Math.round(params.platformFee * 100)}分)`,
    );

    // 优先级：DB(FinanceSettingsService) > env
    const receiver = await this.financeSettings.getActiveProfitSharingReceiver();

    // [LOG-PS-101] 接收方配置状态（关键节点：决定分账是否执行）
    this.logger.log(
      `[PROFIT-SHARE] 接收方配置: enabled=${receiver.enabled}, ` +
        `mchId=${receiver.mchId || '(空)'}, name=${receiver.name || '(空)'}, ` +
        `ENV[WX_PROFIT_SHARING_ENABLED]=${process.env.WX_PROFIT_SHARING_ENABLED ?? '(未设置)'}, ` +
        `ENV[NODE_ENV]=${process.env.NODE_ENV ?? '(未设置)'}, ` +
        `ENV[WX_APP_ID]=${process.env.WX_APP_ID ? '已配置' : '空'}`,
    );

    // 未配置分账接收方 → 跳过
    if (!receiver.enabled) {
      // [LOG-PS-102] 分账跳过（关键节点：资金会停留在 WX_MCH_ID）
      this.logger.warn(
        `[PROFIT-SHARE] ⏭️ 跳过分账（未启用）: outOrderNo=${params.outOrderNo}, ` +
          `platformFee=¥${params.platformFee.toFixed(2)} 将保留在主商户号 WX_MCH_ID, ` +
          `跳过原因=${receiver.mchId ? 'WX_PROFIT_SHARING_ENABLED=false' : '未配置 WX_PROFIT_SHARING_RECEIVER_MCH_ID'}`,
      );
      return { shareOrderId: '', success: false };
    }

    // [LOG-PS-103] 入参校验（排查"分账失败但日志看不懂"的辅助信息）
    if (!params.transactionId) {
      this.logger.error(
        `[PROFIT-SHARE] ❌ 参数校验失败: transactionId 为空，无法调用分账 API（微信分账必须传 transaction_id）, outOrderNo=${params.outOrderNo}`,
      );
      return { shareOrderId: '', success: false };
    }
    if (params.platformFee <= 0) {
      this.logger.warn(
        `[PROFIT-SHARE] ⚠️ platformFee=¥${params.platformFee.toFixed(2)} <= 0，跳过分账（业务层应已过滤，此处为二次保险）, outOrderNo=${params.outOrderNo}`,
      );
      return { shareOrderId: '', success: false };
    }

    // 开发环境 / 未配置微信支付参数 → mock
    if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
      // [LOG-PS-104] 开发环境 mock 路径
      this.logger.warn(
        `[PROFIT-SHARE] 🧪 开发环境 mock: outOrderNo=${params.outOrderNo}, ` +
          `receiver=${receiver.mchId}, platformFee=¥${params.platformFee.toFixed(2)}, ` +
          `返回 shareOrderId=mock_share_${Date.now()}`,
      );
      return { shareOrderId: `mock_share_${Date.now()}`, success: true };
    }

    const url = '/v3/profit-sharing/orders';
    // AppID / 主商户号优先从 DB 读取（老板可在财务设置页覆盖 .env），未配置时回落到 env
    const activeAppId = await this.financeSettings.getActiveAppId();
    const activeMchId = await this.financeSettings.getActiveMainMchId();
    const body = this.wxPay.buildProfitSharingBody(
      {
        transactionId: params.transactionId,
        outOrderNo: params.outOrderNo,
        receivers: [
          {
            type: 'MERCHANT_ID',
            account: receiver.mchId,
            name: receiver.name,
            amount: params.platformFee,
            description: `平台佣金分账-${params.outOrderNo}`,
          },
        ],
      },
      activeAppId,
    );

    // [LOG-PS-105] 构造分账请求体完成（用于排查请求体格式错误、金额单位错误等）
    this.logger.log(
      `[PROFIT-SHARE] 请求体构造完成: url=https://api.mch.weixin.qq.com${url}, ` +
        `body=${body}`,
    );

    try {
      const { authorization } = this.wxPay.buildAuthorization(
        'POST',
        url,
        body,
        undefined,
        undefined,
        activeMchId,
      );

      // [LOG-PS-106] 签名生成成功，准备发送 HTTP 请求（关键节点：网络问题排查锚点）
      this.logger.log(
        `[PROFIT-SHARE] 🚀 发送分账请求: outOrderNo=${params.outOrderNo}, ` +
          `transactionId=${params.transactionId}, ` +
          `platformFee=¥${params.platformFee.toFixed(2)}, ` +
          `receiver=${receiver.mchId}, ` +
          `authorization=${authorization.slice(0, 32)}...`,
      );

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
      // if (data.state === 'ACCEPTED' || data.state === 'SUCCESS') {
      //   return { shareOrderId: data.order_id, success: true };
      // }
      // throw new Error(`分账失败: ${JSON.stringify(data)}`);

      // [LOG-PS-107] 生产环境 HTTP 调用尚未实现（临时占位，需取消上面 TODO 后此日志可删除）
      this.logger.warn(
        `[PROFIT-SHARE] ⚠️ 生产环境 HTTP 调用未实现，使用 mock 返回: outOrderNo=${params.outOrderNo}`,
      );
      void authorization; // 暂保留以备未来 HTTP 调用使用
      return { shareOrderId: `mock_share_${Date.now()}`, success: true };
    } catch (err) {
      // [LOG-PS-108] 分账调用异常（关键节点：错误排查入口）
      const errMsg = (err as Error).message;
      const errStack = (err as Error).stack;
      this.logger.error(
        `[PROFIT-SHARE] ❌ 分账调用失败: outOrderNo=${params.outOrderNo}, ` +
          `transactionId=${params.transactionId}, ` +
          `receiver=${receiver.mchId}, ` +
          `platformFee=¥${params.platformFee.toFixed(2)}, ` +
          `error=${errMsg}`,
      );
      this.logger.error(`[PROFIT-SHARE] 异常堆栈: ${errStack ?? '(无)'}`);
      this.logger.error(
        `[PROFIT-SHARE] 📌 后续处理建议: 订单已 PAID 不回滚，请检查对账任务是否重试此分账单, outOrderNo=${params.outOrderNo}`,
      );
      this.metrics.recordException(receiver.mchId);
      return { shareOrderId: '', success: false };
    }
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

  // ============ 8. 管理后台：按订单号搜索 ============
  /**
   * 按订单号精确查询（供中台管理人员检索订单）
   * @param orderNo 订单号（2 大写字母 + 8 数字）
   */
  async findByOrderNo(orderNo: string): Promise<{
    id: string;
    orderNo: string;
    taskId: string;
    status: string;
    totalAmount: string;
    platformFee: string;
    isSupplement: boolean;
    paidAt: string | null;
    completedAt: string | null;
    createdAt: string;
    refundAmount: string | null;
    taskTitle?: string;
    taskAddress?: string;
    publisherId?: string;
    publisherName?: string;
    helperId?: string;
    helperName?: string;
  } | null> {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            address: true,
            publisherId: true,
            publisher: { select: { id: true, nickname: true } },
          },
        },
        helper: { select: { id: true, nickname: true } },
      },
    });
    if (!order) return null;

    return {
      id: order.id.toString(),
      orderNo: order.orderNo,
      taskId: order.taskId.toString(),
      status: order.status,
      totalAmount: order.totalAmount.toString(),
      platformFee: order.platformFee.toString(),
      isSupplement: order.isSupplement,
      paidAt: order.paidAt?.toISOString() || null,
      completedAt: order.completedAt?.toISOString() || null,
      createdAt: order.createdAt.toISOString(),
      refundAmount: order.refundAmount ? order.refundAmount.toString() : null,
      taskTitle: order.task?.title,
      taskAddress: order.task?.address || undefined,
      publisherId: order.task?.publisherId.toString(),
      publisherName: order.task?.publisher?.nickname,
      helperId: order.helperId?.toString(),
      helperName: order.helper?.nickname,
    };
  }
}
