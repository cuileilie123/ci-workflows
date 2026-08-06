import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export type TransactionType = 'INCOME' | 'EXPENSE' | 'FREEZE' | 'UNFREEZE';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 使用 SELECT ... FOR UPDATE 获取钱包行锁（悲观锁）
   * Prisma 的 findUnique 不支持 FOR UPDATE，需用原生 SQL
   */
  private async lockWallet(
    tx: { $queryRaw: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T> },
    userId: bigint,
    ctx?: { traceId: string; seq: number; total: number },
  ) {
    const tag = ctx ? `🔒[${ctx.traceId}]` : '🔒';
    this.logger.log(
      `${tag} [LOCK-${ctx ? `${ctx.seq}/${ctx.total}` : '-'}] 尝试获取行锁 FOR UPDATE: userId=${userId.toString()}`,
    );
    const rows = await tx.$queryRaw<
      Array<{
        id: bigint;
        user_id: bigint;
        balance: Prisma.Decimal;
        frozen: Prisma.Decimal;
        created_at: Date;
        updated_at: Date;
      }>
    >`SELECT id, user_id, balance, frozen, created_at, updated_at
       FROM wallets
       WHERE user_id = ${userId}
       FOR UPDATE`;

    if (!rows || rows.length === 0) {
      this.logger.warn(`${tag} [LOCK-${ctx ? `${ctx.seq}/${ctx.total}` : '-'}] 获取锁失败 - 钱包不存在: userId=${userId.toString()}`);
      return null;
    }

    const row = rows[0];
    this.logger.log(
      `${tag} [LOCK-${ctx ? `${ctx.seq}/${ctx.total}` : '-'}] ✅ 获取锁成功: userId=${row.user_id.toString()}, walletId=${row.id.toString()}, balance=${Number(row.balance).toFixed(2)}, frozen=${Number(row.frozen).toFixed(2)}`,
    );
    return {
      id: row.id,
      userId: row.user_id,
      balance: row.balance,
      frozen: row.frozen,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 获取钱包信息（不加锁，读操作）
   */
  async getWalletByUserId(userId: bigint) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('钱包不存在');
    }

    return wallet;
  }

  /**
   * 复式记账核心：每笔变动原子性更新余额 + 写入流水
   * 使用 SELECT ... FOR UPDATE 行锁防止并发超扣
   */
  async recordTransaction(
    userId: bigint,
    type: TransactionType,
    amount: number,
    description: string,
    orderId?: bigint,
  ) {
    const traceId = `WAL-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const T = `💰[${traceId}]`;
    this.logger.log(
      `${T} [RECORD] 开始钱包流水: userId=${userId.toString()}, type=${type}, amount=${amount.toFixed(2)}, orderId=${orderId?.toString() || 'none'}, desc=${description}`,
    );

    return this.prisma.$transaction(async (tx) => {
      this.logger.log(`${T} [TX] 进入事务，准备按唯一顺序获取锁（单钱包锁顺序无冲突）`);
      // 1. 获取钱包（SELECT ... FOR UPDATE 悲观锁防止并发）
      const wallet = await this.lockWallet(tx, userId, { traceId, seq: 1, total: 1 });

      if (!wallet) {
        this.logger.error(`${T} [FAIL] 钱包不存在，事务回滚`);
        throw new NotFoundException('钱包不存在，请先注册账户');
      }

      // 2. 计算变动后余额
      let newBalance = Number(wallet.balance);
      let newFrozen = Number(wallet.frozen);
      const amt = Number(amount);

      this.logger.log(
        `${T} [CALC] 当前余额=${newBalance.toFixed(2)}, 冻结=${newFrozen.toFixed(2)}, 类型=${type}, 变动额=${amt.toFixed(2)}`,
      );

      switch (type) {
        case 'INCOME':
          newBalance += amt;
          break;
        case 'EXPENSE':
          if (newBalance < amt) {
            this.logger.warn(
              `${T} [REJECT] EXPENSE 余额不足: 当前=${newBalance.toFixed(2)} < 需要=${amt.toFixed(2)}，事务回滚`,
            );
            throw new ConflictException(`余额不足，当前可用余额 ${newBalance.toFixed(2)} 元`);
          }
          newBalance -= amt;
          break;
        case 'FREEZE':
          if (newBalance < amt) {
            this.logger.warn(
              `${T} [REJECT] FREEZE 余额不足冻结: 当前可用=${newBalance.toFixed(2)} < 需要=${amt.toFixed(2)}，事务回滚`,
            );
            throw new ConflictException(`余额不足冻结，当前可用余额 ${newBalance.toFixed(2)} 元`);
          }
          newBalance -= amt;
          newFrozen += amt;
          break;
        case 'UNFREEZE':
          if (newFrozen < amt) {
            this.logger.warn(
              `${T} [REJECT] UNFREEZE 冻结金额不足: 当前冻结=${newFrozen.toFixed(2)} < 需要=${amt.toFixed(2)}，事务回滚`,
            );
            throw new ConflictException(`冻结金额不足，当前冻结 ${newFrozen.toFixed(2)} 元`);
          }
          newFrozen -= amt;
          newBalance += amt;
          break;
      }

      // 3. 验证余额非负
      if (newBalance < 0) {
        this.logger.error(`${T} [REJECT] 计算后余额负数: newBalance=${newBalance}，事务回滚`);
        throw new ConflictException('操作后余额不能为负数');
      }
      if (newFrozen < 0) {
        this.logger.error(`${T} [REJECT] 计算后冻结负数: newFrozen=${newFrozen}，事务回滚`);
        throw new ConflictException('操作后冻结金额不能为负数');
      }

      // 4. 更新钱包
      this.logger.log(
        `${T} [UPDATE-1/1] 🔸 wallet.update(userId=${userId.toString()}): balance ${Number(wallet.balance).toFixed(2)} → ${newBalance.toFixed(2)}, frozen ${Number(wallet.frozen).toFixed(2)} → ${newFrozen.toFixed(2)}`,
      );
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: new Prisma.Decimal(newBalance),
          frozen: new Prisma.Decimal(newFrozen),
        },
      });
      this.logger.log(`${T} [UPDATE-1/1] ✅ wallet.update 完成`);

      // 5. 写流水（append-only，不可篡改）
      this.logger.log(
        `${T} [TX-CREATE] 写入 transaction.create: walletId=${wallet.id.toString()}, type=${type}, amount=${amt.toFixed(2)}, balanceAfter=${newBalance.toFixed(2)}`,
      );
      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          orderId,
          type,
          amount: new Prisma.Decimal(amt),
          balanceAfter: new Prisma.Decimal(newBalance),
          description,
        },
      });

      this.logger.log(
        `${T} [COMMIT] ✅ 事务提交成功: userId=${userId.toString()}, type=${type}, 最终余额=${newBalance.toFixed(2)}`,
      );

      return transaction;
    });
  }

  /**
   * 查询钱包余额（不加锁，读操作）
   */
  async getBalance(userId: bigint) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        id: true,
        balance: true,
        frozen: true,
      },
    });

    if (!wallet) {
      return this.initWallet(userId);
    }

    return {
      id: wallet.id.toString(),
      balance: Number(wallet.balance),
      frozen: Number(wallet.frozen),
      available: Number(wallet.balance),
    };
  }

  /**
   * 初始化钱包（幂等，并发安全）
   */
  async initWallet(userId: bigint) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        balance: new Prisma.Decimal(0),
        frozen: new Prisma.Decimal(0),
      },
    });

    this.logger.log(`钱包初始化: userId=${userId}, walletId=${wallet.id}`);

    return {
      id: wallet.id.toString(),
      balance: Number(wallet.balance),
      frozen: Number(wallet.frozen),
      available: Number(wallet.balance),
    };
  }

  /**
   * 流水列表（分页）
   */
  async getTransactions(userId: bigint, page = 1, pageSize = 20, type?: TransactionType) {
    const where: Prisma.TransactionWhereInput = {
      wallet: { userId },
    };

    if (type) {
      where.type = type;
    }

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items: items.map((tx) => ({
        id: tx.id.toString(),
        type: tx.type,
        amount: Number(tx.amount),
        balanceAfter: Number(tx.balanceAfter),
        description: tx.description,
        orderId: tx.orderId?.toString() || null,
        createdAt: tx.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  /**
   * 原子执行提现确认（UNFREEZE + EXPENSE 在同一事务内完成）
   */
  async confirmWithdraw(userId: bigint, amount: number, txnId: string) {
    const traceId = `CWD-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const T = `💸[${traceId}]`;
    this.logger.log(
      `${T} [CONFIRM-WITHDRAW] 开始提现确认: userId=${userId.toString()}, amount=${amount.toFixed(2)}, txnId=${txnId}`,
    );

    return this.prisma.$transaction(async (tx) => {
      this.logger.log(`${T} [TX] 进入事务，获取单钱包锁`);
      const wallet = await this.lockWallet(tx, userId, { traceId, seq: 1, total: 1 });

      if (!wallet) {
        this.logger.error(`${T} [FAIL] 钱包不存在`);
        throw new NotFoundException('钱包不存在');
      }

      const newFrozen = Number(wallet.frozen) - amount;
      const newBalance = Number(wallet.balance) + amount - amount;

      if (newFrozen < 0) {
        this.logger.warn(
          `${T} [REJECT] 冻结金额不足: 当前冻结=${Number(wallet.frozen).toFixed(2)} < 提现=${amount.toFixed(2)}`,
        );
        throw new ConflictException('冻结金额不足，无法确认提现');
      }

      this.logger.log(
        `${T} [UPDATE-1/1] wallet.update(id=${wallet.id.toString()}): 冻结 ${Number(wallet.frozen).toFixed(2)} → ${newFrozen.toFixed(2)}, 余额保持 ${newBalance.toFixed(2)}`,
      );
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          frozen: new Prisma.Decimal(newFrozen),
          balance: new Prisma.Decimal(newBalance),
        },
      });
      this.logger.log(`${T} [UPDATE-1/1] ✅ 更新完成`);

      this.logger.log(`${T} [TX-CREATE-1/2] 写入 UNFREEZE 流水`);
      const unfreezeTx = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'UNFREEZE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(newBalance),
          description: '提现解冻',
        },
      });

      this.logger.log(`${T} [TX-CREATE-2/2] 写入 EXPENSE 流水: txnId=${txnId}`);
      const expenseTx = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'EXPENSE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(newBalance),
          description: `提现成功-${txnId}`,
        },
      });

      this.logger.log(
        `${T} [COMMIT] ✅ 提现确认事务提交成功: userId=${userId.toString()}, 剩余冻结=${newFrozen.toFixed(2)}`,
      );
      return { unfreezeTx, expenseTx };
    });
  }

  /**
   * 原子执行提现失败解冻
   */
  async rollbackWithdraw(userId: bigint, amount: number) {
    const traceId = `RWD-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const T = `↩️[${traceId}]`;
    this.logger.log(
      `${T} [ROLLBACK-WITHDRAW] 开始提现回滚（解冻）: userId=${userId.toString()}, amount=${amount.toFixed(2)}`,
    );

    return this.prisma.$transaction(async (tx) => {
      this.logger.log(`${T} [TX] 进入事务，获取单钱包锁`);
      const wallet = await this.lockWallet(tx, userId, { traceId, seq: 1, total: 1 });

      if (!wallet) {
        this.logger.error(`${T} [FAIL] 钱包不存在`);
        throw new NotFoundException('钱包不存在');
      }

      const newFrozen = Number(wallet.frozen) - amount;
      const newBalance = Number(wallet.balance) + amount;

      if (Number(wallet.frozen) < amount) {
        this.logger.warn(
          `${T} [REJECT] 冻结金额不足: 当前冻结=${Number(wallet.frozen).toFixed(2)} < 解冻=${amount.toFixed(2)}`,
        );
        throw new ConflictException('冻结金额不足，无法解冻');
      }

      this.logger.log(
        `${T} [UPDATE-1/1] wallet.update(id=${wallet.id.toString()}): 冻结 ${Number(wallet.frozen).toFixed(2)} → ${newFrozen.toFixed(2)}, 余额 ${Number(wallet.balance).toFixed(2)} → ${newBalance.toFixed(2)}`,
      );
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          frozen: new Prisma.Decimal(newFrozen),
          balance: new Prisma.Decimal(newBalance),
        },
      });
      this.logger.log(`${T} [UPDATE-1/1] ✅ 更新完成`);

      this.logger.log(`${T} [TX-CREATE] 写入 UNFREEZE 流水（提现失败自动解冻）`);
      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'UNFREEZE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(newBalance),
          description: '提现失败自动解冻',
        },
      });

      this.logger.log(
        `${T} [COMMIT] ✅ 提现回滚事务提交成功: userId=${userId.toString()}, 余额=${newBalance.toFixed(2)}, 剩余冻结=${newFrozen.toFixed(2)}`,
      );
      return transaction;
    });
  }

  /**
   * 内部转账
   * 关键：按 userId 升序用 SELECT ... FOR UPDATE 获取行锁，防止 AB-BA 死锁
   */
  async transfer(fromUserId: bigint, toUserId: bigint, amount: number, description = '转账') {
    const traceId = `XFR-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const T = `🔁[${traceId}]`;
    this.logger.log(
      `${T} [TRANSFER-START] from=${fromUserId.toString()} → to=${toUserId.toString()}, amount=${amount.toFixed(2)}, desc=${description}`,
    );

    if (fromUserId === toUserId) {
      this.logger.warn(`${T} [REJECT] 不能向自己转账: from=to=${fromUserId.toString()}`);
      throw new ConflictException('不能向自己转账');
    }

    // 🔑 关键：按 userId 升序排列，确保所有并发请求都以相同顺序获取锁
    const ascending = fromUserId < toUserId;
    const [firstId, secondId] = ascending ? [fromUserId, toUserId] : [toUserId, fromUserId];
    this.logger.log(
      `${T} [SORT-KEY] 🔑 升序加锁规则: firstId=${firstId.toString()}(${ascending ? '=from' : '=to'}) → secondId=${secondId.toString()}(${ascending ? '=to' : '=from'}) | 转账方向 ${fromUserId.toString()}→${toUserId.toString()} ${ascending ? '与加锁顺序一致' : '反向，但仍按升序先锁小的再锁大的'}`,
    );

    return this.prisma.$transaction(async (tx) => {
      this.logger.log(
        `${T} [TX] 进入事务，按升序 firstId=${firstId.toString()} → secondId=${secondId.toString()} 串行获取锁（防止 AB-BA 死锁）`,
      );
      // 按固定顺序 SELECT ... FOR UPDATE 获取行锁
      const firstWallet = await this.lockWallet(tx, firstId, { traceId, seq: 1, total: 2 });
      const secondWallet = await this.lockWallet(tx, secondId, { traceId, seq: 2, total: 2 });

      if (!firstWallet || !secondWallet) {
        this.logger.error(
          `${T} [FAIL] 钱包不存在，事务回滚: firstWallet存在=!!${!!firstWallet}, secondWallet存在=!!${!!secondWallet}`,
        );
        throw new NotFoundException('钱包不存在');
      }
      this.logger.log(
        `${T} [LOCK-OK] ✅ 双锁获取完毕: 先锁 firstId=${firstId.toString()}(余额=${Number(firstWallet.balance).toFixed(2)}) → 再锁 secondId=${secondId.toString()}(余额=${Number(secondWallet.balance).toFixed(2)})`,
      );

      // 根据原始方向确定每个钱包的变动值
      const isFirstFrom = firstId === fromUserId;
      const firstDelta = isFirstFrom ? -amount : amount;
      const secondDelta = isFirstFrom ? amount : -amount;
      this.logger.log(
        `${T} [DELTA] firstId=${firstId.toString()} delta=${firstDelta > 0 ? '+' : ''}${firstDelta.toFixed(2)} (${isFirstFrom ? '扣款方=from' : '收款方=to'}) | secondId=${secondId.toString()} delta=${secondDelta > 0 ? '+' : ''}${secondDelta.toFixed(2)} (${isFirstFrom ? '收款方=to' : '扣款方=from'})`,
      );

      // 验证余额充足
      const fromBalance = isFirstFrom ? Number(firstWallet.balance) : Number(secondWallet.balance);
      this.logger.log(
        `${T} [CHECK] 扣款方余额校验: ${isFirstFrom ? 'first' : 'second'}Wallet(用户=${(isFirstFrom ? fromUserId : toUserId).toString()}) 当前余额=${fromBalance.toFixed(2)} vs 转账=${amount.toFixed(2)}`,
      );
      if (fromBalance < amount) {
        this.logger.warn(
          `${T} [REJECT] ❌ 余额不足: 当前=${fromBalance.toFixed(2)} < 转账=${amount.toFixed(2)}，事务回滚，双锁释放`,
        );
        throw new ConflictException(`余额不足，当前 ${fromBalance.toFixed(2)} 元`);
      }
      this.logger.log(`${T} [CHECK] ✅ 余额充足`);

      // 🔑 关键：始终按排序顺序更新（firstId → secondId）
      // 与 lockWallet 加锁顺序一致，防止 AB-BA 死锁
      const firstNewBalance = Number(firstWallet.balance) + firstDelta;
      const secondNewBalance = Number(secondWallet.balance) + secondDelta;

      this.logger.log(
        `${T} [UPDATE-1/2] 🔸 先更新 firstId=${firstId.toString()}: 余额 ${Number(firstWallet.balance).toFixed(2)} → ${firstNewBalance.toFixed(2)}`,
      );
      await tx.wallet.update({
        where: { id: firstWallet.id },
        data: { balance: new Prisma.Decimal(firstNewBalance) },
      });
      this.logger.log(`${T} [UPDATE-1/2] ✅ firstId wallet.update 完成`);

      this.logger.log(
        `${T} [UPDATE-2/2] 🔸 再更新 secondId=${secondId.toString()}: 余额 ${Number(secondWallet.balance).toFixed(2)} → ${secondNewBalance.toFixed(2)}`,
      );
      await tx.wallet.update({
        where: { id: secondWallet.id },
        data: { balance: new Prisma.Decimal(secondNewBalance) },
      });
      this.logger.log(`${T} [UPDATE-2/2] ✅ secondId wallet.update 完成`);

      // 写流水（双方各一条）
      this.logger.log(
        `${T} [TX-CREATE-1/2] 写 EXPENSE 流水: 钱包 ${(isFirstFrom ? firstWallet.id : secondWallet.id).toString()} (用户=${(isFirstFrom ? firstId : secondId).toString()}) 扣 ${amount.toFixed(2)} 元`,
      );
      await tx.transaction.create({
        data: {
          walletId: isFirstFrom ? firstWallet.id : secondWallet.id,
          type: 'EXPENSE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(fromBalance - amount),
          description: `转账给用户${toUserId}：${description}`,
        },
      });

      this.logger.log(
        `${T} [TX-CREATE-2/2] 写 INCOME 流水: 钱包 ${(isFirstFrom ? secondWallet.id : firstWallet.id).toString()} (用户=${(isFirstFrom ? secondId : firstId).toString()}) 收 ${amount.toFixed(2)} 元`,
      );
      await tx.transaction.create({
        data: {
          walletId: isFirstFrom ? secondWallet.id : firstWallet.id,
          type: 'INCOME',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(isFirstFrom ? secondNewBalance : firstNewBalance),
          description: `来自用户${fromUserId}的转账：${description}`,
        },
      });

      this.logger.log(
        `${T} [COMMIT] ✅ 转账事务提交成功: ${fromUserId.toString()}→${toUserId.toString()} amount=${amount.toFixed(2)} | 顺序: 加锁+更新均 firstId=${firstId.toString()} → secondId=${secondId.toString()}，无 AB-BA 风险`,
      );
    });
  }
}