---
name: wallet-withdraw
description: 实现钱包体系（复式记账）+ 提现到微信零钱
model: claude-4-sonnet
tags: [bff, payment]
depends_on: [nestjs-init, payment-gateway]
---

# 任务：实现钱包 + 提现

## 目标
搭建复式记账钱包系统，支持余额管理、冻结/解冻、提现到微信零钱。

## 具体步骤

### 1. 创建 `src/modules/wallet/wallet.controller.ts`

**接口清单：**
| Method | Path | 说明 |
|--------|------|------|
| GET  | `/api/v1/wallet` | 查询余额 |
| GET  | `/api/v1/wallet/transactions` | 流水列表（分页） |
| POST | `/api/v1/wallet/withdraw` | 提现到零钱 |
| POST | `/api/v1/wallet/transfer` | 内部转账（系统用） |

### 2. 钱包服务 `wallet.service.ts`（复式记账核心）
```typescript
@Injectable()
export class WalletService {
  // 复式记账：每笔变动同时记录借方和贷方
  async recordTransaction(
    userId: number,
    type: 'INCOME' | 'EXPENSE' | 'FREEZE' | 'UNFREEZE',
    amount: number,
    description: string,
    orderId?: number
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. 获取钱包（加锁防止并发）
      const wallet = await tx.wallet.findUnique({
        where: { userId },
        lock: { mode: 'UPDATE' }
      });
      
      if (!wallet) throw new NotFoundException('钱包不存在');
      
      // 2. 计算变动后余额
      let newBalance = wallet.balance;
      let newFrozen = wallet.frozen;
      
      switch (type) {
        case 'INCOME':
          newBalance += amount;
          break;
        case 'EXPENSE':
          if (wallet.balance < amount) throw new ConflictException('余额不足');
          newBalance -= amount;
          break;
        case 'FREEZE':
          if (wallet.balance < amount) throw new ConflictException('余额不足冻结');
          newBalance -= amount;
          newFrozen += amount;
          break;
        case 'UNFREEZE':
          if (wallet.frozen < amount) throw new ConflictException('冻结金额不足');
          newFrozen -= amount;
          newBalance += amount;
          break;
      }
      
      // 3. 更新钱包
      await tx.wallet.update({
        where: { userId },
        data: { balance: newBalance, frozen: newFrozen }
      });
      
      // 4. 写流水（不可篡改，append-only）
      return tx.transaction.create({
        data: {
          walletId: wallet.id,
          type,
          amount,
          balanceAfter: type === 'FREEZE' || type === 'UNFREEZE'
            ? wallet.balance  // 冻结类不影响可用余额记录
            : newBalance,
          description,
          orderId
        }
      });
    });
  }
  
  // 查询余额
  async getBalance(userId: number) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true, frozen: true }
    });
    return wallet || { balance: 0, frozen: 0 };
  }
  
  // 流水列表（分页）
  async getTransactions(userId: number, page = 1, pageSize = 20) {
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { wallet: { userId } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.transaction.count({ where: { wallet: { userId } } })
    ]);
    return { items, total, page, pageSize };
  }
}
```

### 3. 提现逻辑（微信企业付款到零钱）
```typescript
@Post('withdraw')
@UseGuards(JwtAuthGuard)
@RateLimit({ points: 3, duration: 3600 })  // 每小时最多3次
async withdraw(@Body() dto: WithdrawDto, @Req() req) {
  const userId = req.user.sub;
  const amount = dto.amount;
  
  // 1. 参数校验
  if (amount < 1) throw new BadRequestException('最低提现1元');
  if (amount > 5000) {
    // 大额需人工审核
    return this.createAuditRequest(userId, amount, 'WITHDRAW');
  }
  
  // 2. 冻结提现金额
  await this.walletService.recordTransaction(
    userId, 'FREEZE', amount, '提现冻结'
  );
  
  try {
    // 3. 调用微信企业付款 API V3
    const result = await this.wxPay.transferToWxWallet({
      openid: req.user.openid,
      amount: Math.round(amount * 100),  // 分
      description: '邻里互助提现',
      outTradeNo: `WD${Date.now()}${userId}`
    });
    
    if (result.status === 'SUCCESS') {
      // 4a. 成功 → 确认扣减
      await this.walletService.recordTransaction(
        userId, 'EXPENSE', amount, `提现成功-${result.transactionId}`
      );
      // 解冻差额（FREEZE+EXPENSE 已处理）
      return { status: 'SUCCESS', message: '提现成功，预计1-3个工作日到账' };
    }
  } catch (err) {
    // 4b. 失败 → 解冻
    await this.walletService.recordTransaction(
      userId, 'UNFREEZE', amount, '提现失败解冻'
    );
    throw new ServiceUnavailableException('提现失败，请稍后重试');
  }
}
```

### 4. 钱包初始化（注册时自动创建）
```typescript
// 在 auth.service.ts 的注册流程中
await this.prisma.wallet.create({
  data: { userId: user.id, balance: 0, frozen: 0 }
});
```

### 5. 前端钱包页面 `pages/user/wallet.vue`
- 余额卡片：可用余额 + 冻结金额
- 流水列表：收入绿色 / 支出红色，图标区分类型
- 提现按钮 → 弹窗输入金额 → 确认 → 加载中 → 结果
- 提现记录 tab

### 6. 流水加密导出（GDPR 合规）
```typescript
// GET /api/v1/wallet/export
// 生成 CSV → AES 加密 → 返回下载链接（COS 临时 URL）
```

## 验收标准
- [ ] 钱包初始余额 0
- [ ] 收入/支出/冻结/解冻 流水正确
- [ ] 并发扣款不超扣（事务隔离）
- [ ] 提现到零钱成功
- [ ] 大额提现进入审核
- [ ] 提现失败自动解冻
- [ ] 流水不可篡改（append-only）
- [ ] 分页查询正常

## 参考文件
- `specs/03-payment.md` → 钱包体系 + 提现
- `.trae/memory.md` → ADR-004 + 禁止事项
