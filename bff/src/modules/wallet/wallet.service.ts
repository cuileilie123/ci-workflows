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
  ) {
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
      return null;
    }

    const row = rows[0];
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
    return this.prisma.$transaction(async (tx) => {
      // 1. 获取钱包（SELECT ... FOR UPDATE 悲观锁防止并发）
      const wallet = await this.lockWallet(tx, userId);

      if (!wallet) {
        throw new NotFoundException('钱包不存在，请先注册账户');
      }

      // 2. 计算变动后余额
      let newBalance = Number(wallet.balance);
      let newFrozen = Number(wallet.frozen);
      const amt = Number(amount);

      switch (type) {
        case 'INCOME':
          newBalance += amt;
          break;
        case 'EXPENSE':
          if (newBalance < amt) {
            throw new ConflictException(`余额不足，当前可用余额 ${newBalance.toFixed(2)} 元`);
          }
          newBalance -= amt;
          break;
        case 'FREEZE':
          if (newBalance < amt) {
            throw new ConflictException(`余额不足冻结，当前可用余额 ${newBalance.toFixed(2)} 元`);
          }
          newBalance -= amt;
          newFrozen += amt;
          break;
        case 'UNFREEZE':
          if (newFrozen < amt) {
            throw new ConflictException(`冻结金额不足，当前冻结 ${newFrozen.toFixed(2)} 元`);
          }
          newFrozen -= amt;
          newBalance += amt;
          break;
      }

      // 3. 验证余额非负
      if (newBalance < 0) {
        throw new ConflictException('操作后余额不能为负数');
      }
      if (newFrozen < 0) {
        throw new ConflictException('操作后冻结金额不能为负数');
      }

      // 4. 更新钱包
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: new Prisma.Decimal(newBalance),
          frozen: new Prisma.Decimal(newFrozen),
        },
      });

      // 5. 写流水（append-only，不可篡改）
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
        `钱包流水: userId=${userId}, type=${type}, amount=${amt}, balanceAfter=${newBalance}`,
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
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.lockWallet(tx, userId);

      if (!wallet) {
        throw new NotFoundException('钱包不存在');
      }

      const newFrozen = Number(wallet.frozen) - amount;
      const newBalance = Number(wallet.balance) + amount - amount;

      if (newFrozen < 0) {
        throw new ConflictException('冻结金额不足，无法确认提现');
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          frozen: new Prisma.Decimal(newFrozen),
          balance: new Prisma.Decimal(newBalance),
        },
      });

      const unfreezeTx = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'UNFREEZE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(newBalance),
          description: '提现解冻',
        },
      });

      const expenseTx = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'EXPENSE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(newBalance),
          description: `提现成功-${txnId}`,
        },
      });

      this.logger.log(`提现确认: userId=${userId}, amount=${amount}`);
      return { unfreezeTx, expenseTx };
    });
  }

  /**
   * 原子执行提现失败解冻
   */
  async rollbackWithdraw(userId: bigint, amount: number) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.lockWallet(tx, userId);

      if (!wallet) {
        throw new NotFoundException('钱包不存在');
      }

      const newFrozen = Number(wallet.frozen) - amount;
      const newBalance = Number(wallet.balance) + amount;

      if (Number(wallet.frozen) < amount) {
        throw new ConflictException('冻结金额不足，无法解冻');
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          frozen: new Prisma.Decimal(newFrozen),
          balance: new Prisma.Decimal(newBalance),
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'UNFREEZE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(newBalance),
          description: '提现失败自动解冻',
        },
      });

      this.logger.log(`提现回滚: userId=${userId}, amount=${amount}`);
      return transaction;
    });
  }

  /**
   * 内部转账
   * 关键：按 userId 升序用 SELECT ... FOR UPDATE 获取行锁，防止 AB-BA 死锁
   */
  async transfer(fromUserId: bigint, toUserId: bigint, amount: number, description = '转账') {
    if (fromUserId === toUserId) {
      throw new ConflictException('不能向自己转账');
    }

    // 🔑 关键：按 userId 升序排列，确保所有并发请求都以相同顺序获取锁
    const [firstId, secondId] =
      fromUserId < toUserId ? [fromUserId, toUserId] : [toUserId, fromUserId];

    return this.prisma.$transaction(async (tx) => {
      // 按固定顺序 SELECT ... FOR UPDATE 获取行锁
      const firstWallet = await this.lockWallet(tx, firstId);
      const secondWallet = await this.lockWallet(tx, secondId);

      if (!firstWallet || !secondWallet) {
        throw new NotFoundException('钱包不存在');
      }

      // 根据原始方向确定每个钱包的变动值
      const isFirstFrom = firstId === fromUserId;
      const firstDelta = isFirstFrom ? -amount : amount;
      const secondDelta = isFirstFrom ? amount : -amount;

      // 验证余额充足
      const fromBalance = isFirstFrom ? Number(firstWallet.balance) : Number(secondWallet.balance);
      if (fromBalance < amount) {
        throw new ConflictException(`余额不足，当前 ${fromBalance.toFixed(2)} 元`);
      }

      // 🔑 关键：始终按排序顺序更新（firstId → secondId）
      // 与 lockWallet 加锁顺序一致，防止 AB-BA 死锁
      const firstNewBalance = Number(firstWallet.balance) + firstDelta;
      const secondNewBalance = Number(secondWallet.balance) + secondDelta;

      await tx.wallet.update({
        where: { id: firstWallet.id },
        data: { balance: new Prisma.Decimal(firstNewBalance) },
      });

      await tx.wallet.update({
        where: { id: secondWallet.id },
        data: { balance: new Prisma.Decimal(secondNewBalance) },
      });

      // 写流水（双方各一条）
      await tx.transaction.create({
        data: {
          walletId: isFirstFrom ? firstWallet.id : secondWallet.id,
          type: 'EXPENSE',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(fromBalance - amount),
          description: `转账给用户${toUserId}：${description}`,
        },
      });

      await tx.transaction.create({
        data: {
          walletId: isFirstFrom ? secondWallet.id : firstWallet.id,
          type: 'INCOME',
          amount: new Prisma.Decimal(amount),
          balanceAfter: new Prisma.Decimal(isFirstFrom ? secondNewBalance : firstNewBalance),
          description: `来自用户${fromUserId}的转账：${description}`,
        },
      });

      this.logger.log(`转账成功: ${fromUserId} → ${toUserId}, 金额=${amount}`);
    });
  }
}