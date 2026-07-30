---
name: payment-gateway
description: 实现微信支付V3全流程（下单+回调+退款）
model: claude-4-sonnet
tags: [bff, payment]
depends_on: [nestjs-init, task-service]
---

# 任务：实现微信支付网关

## 目标
完成微信支付 V3 版的统一下单、支付回调、退款全流程。

## 具体步骤

### 1. 创建 `src/modules/payment/payment.controller.ts`

**接口清单：**
| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/pay/create-order` | 创建支付订单 |
| POST | `/api/v1/pay/notify` | 微信支付回调（公网可访问） |
| GET  | `/api/v1/pay/query/:orderId` | 查询订单状态 |
| POST | `/api/v1/pay/refund` | 申请退款 |
| POST | `/api/v1/pay/withdraw` | 提现到零钱 |

### 2. 微信支付 V3 签名工具 `wx-pay.util.ts`
```typescript
// V3 签名规则：GET/POST + 路径 + 时间戳 + 随机串 + 请求体
function generateSignature(method, url, body, timestamp, nonce) {
  const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
  return signWithRSA(message, privateKey); // SHA256withRSA
}

// 验签（回调时验证微信签名）
function verifySignature(timestamp, nonce, body, signature) {
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  return verifyWithRSA(message, signature, wxPublicKey);
}
```

### 3. 创建支付订单
```typescript
@Post('create-order')
@UseGuards(JwtAuthGuard)
async createOrder(@Body() dto: CreateOrderDto, @Req() req) {
  // 1. 查询任务
  const task = await this.prisma.task.findUnique({ where: { id: dto.taskId } });
  if (!task) throw new NotFoundException('任务不存在');
  if (task.status !== 'ASSIGNED') throw new ConflictException('任务状态异常');
  
  // 2. 创建内部订单（状态 PENDING）
  const order = await this.prisma.order.create({
    data: {
      taskId: task.id,
      helperId: task.helperId,
      totalAmount: task.price,
      platformFee: task.price * 0.1,
      status: 'PENDING'
    }
  });
  
  // 3. 调用微信统一下单 V3
  const wxOrder = await this.wxPay.createOrder({
    outTradeNo: order.id.toString(),
    description: task.title,
    amount: { total: Math.round(task.price * 100), currency: 'CNY' },
    payer: { openid: req.user.openid }
  });
  
  // 4. 返回预支付参数（二次签名给前端）
  return {
    timeStamp: Math.floor(Date.now() / 1000).toString(),
    nonceStr: generateNonce(),
    package: `prepay_id=${wxOrder.prepayId}`,
    signType: 'RSA',
    paySign: this.signForFrontend(wxOrder.prepayId)
  };
}
```

### 4. 支付回调处理
```typescript
@Post('notify')
async handleNotify(@Headers() headers, @Body() body) {
  // 1. 验签
  const valid = this.wxPay.verifySignature(
    headers['wechatpay-timestamp'],
    headers['wechatpay-nonce'],
    JSON.stringify(body),
    headers['wechatpay-signature']
  );
  if (!valid) throw new UnauthorizedException('签名验证失败');
  
  // 2. 解密报文
  const decrypted = this.wxPay.decryptResource(body.resource);
  // decrypted = { out_trade_no, trade_state, amount, ... }
  
  // 3. 更新订单状态
  if (decrypted.trade_state === 'SUCCESS') {
    await this.prisma.order.update({
      where: { id: Number(decrypted.out_trade_no) },
      data: { status: 'PAID', paidAt: new Date() }
    });
    // 4. 发消息到 RabbitMQ → 触发后续流程
    this.mq.send('order.paid', { orderId: decrypted.out_trade_no });
  }
  
  // 5. 返回成功响应（微信要求）
  return { code: 'SUCCESS', message: '成功' };
}
```

### 5. 退款逻辑
```typescript
@Post('refund')
@UseGuards(JwtAuthGuard)
async refund(@Body() dto: RefundDto, @Req() req) {
  // 1. 验证订单归属
  const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
  if (order.task.publisherId !== req.user.sub) throw new ForbiddenException();
  
  // 2. 调用微信退款 API V3
  const result = await this.wxPay.refund({
    outTradeNo: order.id.toString(),
    refundAmount: Math.round(dto.amount * 100),
    reason: dto.reason
  });
  
  // 3. 更新订单状态
  await this.prisma.order.update({
    where: { id: order.id },
    data: { status: 'REFUNDED', refundAmount: dto.amount }
  });
  
  return result;
}
```

### 6. 延迟队列（15分钟未支付自动取消）
- RabbitMQ TTL + DLX
- 消息：{ orderId, expireAt }
- 消费者检查订单仍为 PENDING → 取消 + 释放任务

## 验收标准
- [ ] 统一下单返回正确预支付参数
- [ ] 支付回调验签通过
- [ ] 订单状态正确更新为 PAID
- [ ] 退款原路退回
- [ ] 15分钟未支付自动取消
- [ ] 签名错误有日志告警

## 参考文件
- `specs/03-payment.md` → 全部章节
- `.trae/memory.md` → ADR-002 + 已知坑（签名验证失败）
