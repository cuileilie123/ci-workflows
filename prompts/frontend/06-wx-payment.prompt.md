---
name: wx-payment
description: 集成微信支付（下单+拉起支付+回调处理）
model: claude-4-sonnet
tags: [frontend, payment]
depends_on: [task-detail, wx-login]
---

# 任务：集成微信支付

## 目标
在任务接单成功后，引导用户完成微信支付，支付成功后更新订单状态。

## 具体步骤

### 1. 创建 `src/api/payment.ts`
```typescript
export interface PayParams {
  timeStamp: string;
  nonceStr: string;
  package: string;       // "prepay_id=xxx"
  signType: 'RSA';
  paySign: string;
}

export function createOrder(taskId: number, amount: number): Promise<{ orderId: string }>;
export function getPayParams(orderId: string): Promise<PayParams>;
export function queryOrderStatus(orderId: string): Promise<'PENDING' | 'PAID' | 'CANCELLED'>;
```

### 2. 支付流程 `utils/payment.ts`
```typescript
export async function payForTask(taskId: number, amount: number) {
  // 1. 创建订单
  const { orderId } = await createOrder(taskId, amount);
  
  // 2. 获取支付参数
  const params = await getPayParams(orderId);
  
  // 3. 拉起支付
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...params,
      success: () => resolve(orderId),
      fail: (err) => {
        if (err.errMsg.includes('cancel')) {
          // 用户取消，订单保留为 PENDING
          resolve(null);
        } else {
          reject(err);
        }
      }
    });
  });
}
```

### 3. 支付确认弹窗组件 `components/pay-confirm/index.vue`
- 展示任务标题、金额、平台费率、实付金额
- 优惠券选择（如有）
- "确认支付"按钮 → 调起支付
- 支付中 loading 遮罩（防重复点击）

### 4. 支付结果处理
- 支付成功 → 跳转订单详情页
- 支付取消 → 保留当前页，订单状态 PENDING
- 支付失败 → Toast 提示 + 重试按钮
- 轮询订单状态（每 3s，最多 10 次）兜底

### 5. 订单详情页 `pages/order/detail.vue`
- 展示订单号、任务信息、金额明细
- 状态：待支付 / 已支付 / 进行中 / 已完成 / 已取消
- 操作：去支付 / 取消订单 / 联系客服 / 申请退款

## 验收标准
- [ ] 支付流程完整可用
- [ ] 支付取消后订单状态正确
- [ ] 支付成功跳转正确
- [ ] 网络异常有重试机制
- [ ] 防重复点击有效

## 参考文件
- `specs/03-payment.md` → 微信支付流程
- `.trae/memory.md` → ADR-002 微信支付 V3
