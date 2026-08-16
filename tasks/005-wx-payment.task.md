# Task 005: 微信支付闭环

- **Prompts**:
  - `prompts/frontend/06-wx-payment.prompt.md`
  - `prompts/bff/04-payment-gateway.prompt.md`
- **执行顺序**: 5
- **状态**: completed
- **依赖**: Task 004
- **预估时间**: 3 小时
- **说明**: 统一下单 → 拉起支付 → 回调验签 → 订单状态更新 → 退款
- **验收**:
  - [x] 统一下单返回正确预支付参数
  - [x] 小程序能拉起微信支付
  - [x] 支付成功回调验签通过
  - [x] 订单状态更新为 PAID
  - [x] 支付取消订单保留 PENDING
  - [x] 退款原路退回成功
  - [x] 15分钟未支付自动取消
  - [x] 平台费率 10% 正确计算
  - [x] 钱包流水记录正确
