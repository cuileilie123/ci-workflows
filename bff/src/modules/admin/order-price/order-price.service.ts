import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProfitSharingService } from '../profit-sharing/profit-sharing.service';
import { CreatePriceModificationDto } from './dto/create-price-modification.dto';
import { generateUniqueOrderNo } from '../../payment/order-no.util';

/** 可改价的任务状态（已发布且未完成） */
const MODIFIABLE_STATUSES: TaskStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'];

@Injectable()
export class OrderPriceService {
  private readonly logger = new Logger(OrderPriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profitSharing: ProfitSharingService,
  ) {}

  /** 工作人员视角：列出可改价的已发布未完成任务 */
  async findIncompleteTasks(page = 1, pageSize = 20) {
    const take = Math.min(pageSize, 100);
    const skip = (page - 1) * take;

    const where: Prisma.TaskWhereInput = {
      status: { in: MODIFIABLE_STATUSES },
      deletedAt: null,
    };

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          price: true,
          status: true,
          address: true,
          categoryId: true,
          publisherId: true,
          helperId: true,
          createdAt: true,
          category: { select: { name: true } },
          publisher: { select: { nickname: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    return {
      list: tasks.map((t) => ({
        id: t.id.toString(),
        title: t.title,
        price: Number(t.price),
        status: t.status,
        address: t.address,
        categoryName: t.category?.name,
        publisherId: t.publisherId.toString(),
        publisherNickname: t.publisher?.nickname,
        helperId: t.helperId?.toString() ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: take,
      hasMore: page * take < total,
    };
  }

  /** 工作人员发起改价：记录改价单并冻结任务为 PRICE_PENDING */
  async createPriceModification(
    staffId: string,
    taskId: string,
    dto: CreatePriceModificationDto,
    ip?: string,
  ) {
    const tid = BigInt(taskId);
    const task = await this.prisma.task.findUnique({ where: { id: tid } });
    if (!task || task.deletedAt) throw new NotFoundException('任务不存在');

    if (!MODIFIABLE_STATUSES.includes(task.status)) {
      throw new BadRequestException(
        `当前任务状态为 ${task.status}，仅 ${MODIFIABLE_STATUSES.join('/')} 状态可改价`,
      );
    }

    if (Math.abs(dto.newPrice - Number(task.price)) < 0.01) {
      throw new BadRequestException('新价格与原价格相同');
    }

    // 已存在待确认的改价单
    const existingPending = await this.prisma.priceModification.findFirst({
      where: { taskId: tid, status: 'PENDING' },
    });
    if (existingPending) {
      throw new ConflictException('该任务已有待确认的改价单');
    }

    const mod = await this.prisma.priceModification.create({
      data: {
        taskId: tid,
        staffId: BigInt(staffId),
        oldPrice: task.price,
        newPrice: dto.newPrice,
        reason: dto.reason ?? null,
        previousStatus: task.status,
        status: 'PENDING',
      },
    });

    // 冻结任务，等待发布者确认
    await this.prisma.task.update({
      where: { id: tid },
      data: { status: 'PRICE_PENDING' },
    });

    await this.writeAuditLog(staffId, 'CREATE_PRICE_MODIFICATION', tid, dto, ip);

    this.logger.log(
      `改价单创建: taskId=${taskId}, ${Number(task.price)}→${dto.newPrice}, staffId=${staffId}`,
    );

    return {
      id: mod.id.toString(),
      taskId: mod.taskId.toString(),
      oldPrice: Number(mod.oldPrice),
      newPrice: Number(mod.newPrice),
      reason: mod.reason,
      previousStatus: mod.previousStatus,
      status: mod.status,
      createdAt: mod.createdAt.toISOString(),
    };
  }

  /** 发布者视角：查询自己待确认的改价单 */
  async findMyPendingPriceChanges(userId: string) {
    const uid = BigInt(userId);
    const mods = await this.prisma.priceModification.findMany({
      where: { task: { publisherId: uid }, status: 'PENDING' },
      include: {
        task: {
          select: { id: true, title: true, price: true, address: true, categoryId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return mods.map((m) => ({
      id: m.id.toString(),
      taskId: m.taskId.toString(),
      taskTitle: m.task.title,
      oldPrice: Number(m.oldPrice),
      newPrice: Number(m.newPrice),
      reason: m.reason,
      previousStatus: m.previousStatus,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  /**
   * 发布者确认改价：结算差额后任务回到合理状态
   *
   * 已接单任务（有 PAID 订单 + helperId）：
   *   - 补差：创建 PENDING 补差订单 → 任务保持 PRICE_PENDING（等支付）→ 回调后回到 previousStatus
   *   - 退差：自动退差到发布者钱包 → 减少 helper 冻结 → 任务回到 previousStatus（保留 helperId）
   *
   * 未接单任务（无 PAID 订单）：
   *   - 直接改价 → 任务回到 OPEN
   */
  async confirmPriceChange(userId: string, taskId: string, ip?: string) {
    const uid = BigInt(userId);
    const tid = BigInt(taskId);

    const task = await this.prisma.task.findUnique({ where: { id: tid } });
    if (!task || task.deletedAt) throw new NotFoundException('任务不存在');
    if (task.publisherId !== uid) {
      throw new ForbiddenException('仅任务发布者可确认改价');
    }
    if (task.status !== 'PRICE_PENDING') {
      throw new BadRequestException('该任务当前无待确认的改价');
    }

    const mod = await this.prisma.priceModification.findFirst({
      where: { taskId: tid, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!mod) throw new NotFoundException('未找到待确认的改价单');

    const oldPrice = Number(mod.oldPrice);
    const newPrice = Number(mod.newPrice);
    const difference = newPrice - oldPrice; // >0 补差, <0 退差

    // 查找关联的已支付订单（非补差订单）
    const order = await this.prisma.order.findFirst({
      where: { taskId: tid, isSupplement: false },
      orderBy: { createdAt: 'desc' },
    });

    // 判断是否已接单（有已支付订单 + 有接单者）
    const hasActiveHelper =
      task.helperId !== null && order && ['PAID', 'IN_PROGRESS'].includes(order.status);

    // 跟踪实际执行的结算动作
    let actualSettlement:
      'NO_DIFFERENCE' | 'REFUNDED' | 'SUPPLEMENT_PENDING' | 'NO_ORDER_TO_SETTLE' = 'NO_DIFFERENCE';

    const settled = await this.prisma
      .$transaction(async (tx) => {
        if (hasActiveHelper && difference > 0) {
          // ===== 补差场景（已接单）：创建补差订单，保持 PRICE_PENDING 等待支付 =====
          const sharing = await this.profitSharing.calculate(difference, task.categoryId);
          const supplementOrderNo = await generateUniqueOrderNo(async (no) => {
            const existing = await this.prisma.order.findUnique({ where: { orderNo: no } });
            return !!existing;
          });
          await tx.order.create({
            data: {
              orderNo: supplementOrderNo,
              taskId: tid,
              helperId: task.helperId!,
              totalAmount: difference,
              platformFee: sharing.platformFee,
              status: 'PENDING',
              isSupplement: true,
            },
          });
          actualSettlement = 'SUPPLEMENT_PENDING';

          // 任务保持 PRICE_PENDING（等补差支付回调），仅更新价格，保留 helperId
          await tx.task.update({
            where: { id: tid },
            data: { price: newPrice },
          });
        } else if (hasActiveHelper && difference < 0) {
          // ===== 退差场景（已接单）：自动退差，任务回到 previousStatus =====
          const refundAmount = Math.abs(difference);

          // 1. 在原订单上记录退款
          await tx.order.update({
            where: { id: order!.id },
            data: {
              refundAmount,
              refundReason: `工作人员改价退差 ${oldPrice}→${newPrice}`,
            },
          });

          // 2. 退差入发布者钱包
          await this.creditPublisherWallet(tx, uid, refundAmount, tid);

          // 3. 减少接单者冻结金额（仅退差额中的接单者部分，不是全部解冻）
          // helperRate = (totalAmount - platformFee) / totalAmount
          const helperRate =
            (Number(order!.totalAmount) - Number(order!.platformFee)) / Number(order!.totalAmount);
          const helperRefund = refundAmount * helperRate;
          await this.reduceHelperFrozen(tx, task.helperId!, tid, order!.id, helperRefund);

          actualSettlement = 'REFUNDED';

          // 4. 任务回到 previousStatus（ASSIGNED 或 IN_PROGRESS），保留 helperId
          await tx.task.update({
            where: { id: tid },
            data: { price: newPrice, status: mod.previousStatus },
          });
        } else if (order && order.status === 'PENDING') {
          // ===== 未支付订单：取消订单，回到 OPEN =====
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'CANCELLED' },
          });
          actualSettlement = 'NO_DIFFERENCE';

          await tx.task.update({
            where: { id: tid },
            data: { price: newPrice, status: 'OPEN', helperId: null },
          });
        } else {
          // ===== 无关联订单（任务尚未被接单/支付）：直接改价，回到 OPEN =====
          actualSettlement = 'NO_ORDER_TO_SETTLE';

          await tx.task.update({
            where: { id: tid },
            data: { price: newPrice, status: 'OPEN', helperId: null },
          });
        }

        // 标记改价单为已确认
        await tx.priceModification.update({
          where: { id: mod.id },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        return { oldPrice, newPrice, difference };
      })
      .catch((err) => {
        this.logger.error(`确认改价失败: ${(err as Error).message}`);
        throw err;
      });

    await this.writeAuditLog(
      userId,
      'CONFIRM_PRICE_CHANGE',
      tid,
      { ...settled, actualSettlement },
      ip,
    );

    this.logger.log(
      `改价已确认: taskId=${taskId}, ${oldPrice}→${newPrice}, 补退差额=${difference}, 实际结算=${actualSettlement}, 已接单=${hasActiveHelper}`,
    );

    return {
      success: true,
      taskId: taskId,
      oldPrice,
      newPrice,
      difference,
      settlement: actualSettlement,
    };
  }

  /** 发布者拒绝改价：恢复任务原状态 */
  async rejectPriceChange(userId: string, taskId: string, ip?: string) {
    const uid = BigInt(userId);
    const tid = BigInt(taskId);

    const task = await this.prisma.task.findUnique({ where: { id: tid } });
    if (!task || task.deletedAt) throw new NotFoundException('任务不存在');
    if (task.publisherId !== uid) {
      throw new ForbiddenException('仅任务发布者可拒绝改价');
    }
    if (task.status !== 'PRICE_PENDING') {
      throw new BadRequestException('该任务当前无待确认的改价');
    }

    const mod = await this.prisma.priceModification.findFirst({
      where: { taskId: tid, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!mod) throw new NotFoundException('未找到待确认的改价单');

    await this.prisma.$transaction(async (tx) => {
      // 恢复任务原状态
      await tx.task.update({
        where: { id: tid },
        data: { status: mod.previousStatus },
      });

      await tx.priceModification.update({
        where: { id: mod.id },
        data: { status: 'REJECTED', confirmedAt: new Date() },
      });
    });

    await this.writeAuditLog(
      userId,
      'REJECT_PRICE_CHANGE',
      tid,
      { oldPrice: Number(mod.oldPrice), newPrice: Number(mod.newPrice) },
      ip,
    );

    this.logger.log(`改价已拒绝: taskId=${taskId}, 恢复状态=${mod.previousStatus}`);

    return { success: true, restoredStatus: mod.previousStatus };
  }

  /** 退款入发布者钱包（平台退款信用） */
  private async creditPublisherWallet(
    tx: Prisma.TransactionClient,
    publisherId: bigint,
    amount: number,
    taskId: bigint,
  ): Promise<void> {
    let wallet = await tx.wallet.findUnique({ where: { userId: publisherId } });
    if (!wallet) {
      wallet = await tx.wallet.create({ data: { userId: publisherId } });
    }
    const newBalance = Number(wallet.balance) + amount;
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: new Prisma.Decimal(newBalance) },
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        orderId: null,
        type: 'INCOME',
        amount: new Prisma.Decimal(amount),
        balanceAfter: new Prisma.Decimal(newBalance),
        description: `工作人员改价退差（任务 ${taskId.toString()}）`,
      },
    });
  }

  /** 解除接单者在改价订单上的冻结金额（订单作废，全额解冻） */
  private async unfreezeHelper(
    tx: Prisma.TransactionClient,
    helperId: bigint,
    taskId: bigint,
  ): Promise<void> {
    const wallet = await tx.wallet.findUnique({ where: { userId: helperId } });
    if (!wallet) return;

    // 查找该任务关联订单的冻结流水金额（非补差订单）
    const order = await tx.order.findFirst({
      where: { taskId, isSupplement: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!order) return;

    // 冻结金额 = 订单总额 - 平台抽成 = 接单者应得
    const freezeAmount = Number(order.totalAmount) - Number(order.platformFee);
    if (freezeAmount <= 0) return;

    const newFrozen = Math.max(0, Number(wallet.frozen) - freezeAmount);
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { frozen: new Prisma.Decimal(newFrozen) },
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        orderId: order.id,
        type: 'UNFREEZE',
        amount: new Prisma.Decimal(freezeAmount),
        balanceAfter: Number(wallet.balance),
        description: `改价作废订单-解冻（任务 ${taskId.toString()}）`,
      },
    });
  }

  /**
   * 减少接单者的冻结金额（退差场景，仅减少差额中的接单者部分）
   * 与 unfreezeHelper 不同：不全部解冻，只减少退差额对应的接单者应得部分
   */
  private async reduceHelperFrozen(
    tx: Prisma.TransactionClient,
    helperId: bigint,
    taskId: bigint,
    orderId: bigint,
    amount: number,
  ): Promise<void> {
    if (amount <= 0) return;

    const wallet = await tx.wallet.findUnique({ where: { userId: helperId } });
    if (!wallet) return;

    const newFrozen = Math.max(0, Number(wallet.frozen) - amount);
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { frozen: new Prisma.Decimal(newFrozen) },
    });
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        orderId,
        type: 'UNFREEZE',
        amount: new Prisma.Decimal(amount),
        balanceAfter: Number(wallet.balance),
        description: `改价退差-减少冻结（任务 ${taskId.toString()}）`,
      },
    });
  }

  private async writeAuditLog(
    actorId: string,
    action: string,
    targetId: bigint,
    detail: unknown,
    ip?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          adminId: BigInt(actorId),
          action,
          targetType: 'PRICE_MODIFICATION',
          targetId,
          detail: (detail ?? {}) as Prisma.InputJsonValue,
          ip: ip ?? '127.0.0.1',
        },
      });
    } catch (err) {
      this.logger.warn(`写入审计日志失败: ${(err as Error).message}`);
    }
  }
}
