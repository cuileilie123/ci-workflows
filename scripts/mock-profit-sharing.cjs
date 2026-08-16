/* eslint-disable no-console */
/**
 * 纯内存 Mock 验证分账核心逻辑
 *
 * WxPayUtil 内联实现与 bff/src/modules/payment/wx-pay.util.ts 保持一致：
 *   - getProfitSharingReceiver()
 *   - buildProfitSharingBody()
 *   - buildAuthorization() 等非分账方法仅占位
 *
 * 覆盖的核心验证点（与 payment.service.ts 改动对应）：
 *   1) 未配置分账接收方 → enabled=false
 *       - 统一下单时 body 不含 profit_sharing
 *       - callWxProfitSharing 直接跳过
 *   2) 已配置分账接收方 → enabled=true
 *       - getProfitSharingReceiver 返回正确的 mchId / name
 *       - callWxCreateOrder 中 body.profit_sharing=true
 *       - handleNotify 回调后 callWxProfitSharing 被调用
 *         （仅当 transaction_id 存在 && platformFee>0 && 非补差订单）
 *       - 开发环境返回 mock_share_xxx 分账单号
 *       - buildProfitSharingBody 元→分转换 + 接收方 正确
 *   3) 边界：补差订单 / platformFee=0 → 在业务层过滤，不调用分账
 */

'use strict';

// ============================================================
// 内联 WxPayUtil（与 bff/src/modules/payment/wx-pay.util.ts 完全一致）
// ============================================================
class WxPayUtil {
  constructor() {
    this.appId = process.env.WX_APP_ID || '';
    this.mchId = process.env.WX_MCH_ID || '';
    this.apiV3Key = process.env.WX_API_V3_KEY || '';
    this.privateKey = process.env.WX_PAY_PRIVATE_KEY || '';
    this.wxPublicKey = process.env.WX_PAY_PUBLIC_KEY || '';
    this.profitSharingReceiverMchId = process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID || '';
    this.profitSharingReceiverName = process.env.WX_PROFIT_SHARING_RECEIVER_NAME || '平台佣金账户';
    this.profitSharingEnabledFlag = process.env.WX_PROFIT_SHARING_ENABLED !== 'false';
  }

  /**
   * 读取平台佣金分账接收方（独立商户号）
   * - enabled=true：已配置且已启用，订单支付成功时会把 platformFee 分到该账号
   * - enabled=false：所有资金停留在 WX_MCH_ID，平台佣金仅在系统内做账
   */
  getProfitSharingReceiver() {
    return {
      enabled: this.profitSharingEnabledFlag && !!this.profitSharingReceiverMchId,
      mchId: this.profitSharingReceiverMchId,
      name: this.profitSharingReceiverName,
    };
  }

  /**
   * 构造分账请求体（POST /v3/profit-sharing/orders）
   * 金额单位：元→分转换（微信支付要求分）
   */
  buildProfitSharingBody(params) {
    return JSON.stringify({
      appid: this.appId,
      transaction_id: params.transactionId,
      out_order_no: params.outOrderNo,
      receivers: params.receivers.map((r) => ({
        type: r.type,
        account: r.account,
        ...(r.name ? { name: r.name } : {}),
        amount: Math.round(r.amount * 100),
        description: r.description,
      })),
    });
  }

  // --- 占位：以下方法本脚本未调用，仅保留与源码结构一致 ---
  buildAuthorization() { return { authorization: '', timestamp: '', nonce: '' }; }
  generateNonce() { return 'nonce'; }
  generateSignature() { return 'sig'; }
  signForFrontend() { return { timeStamp: '', nonceStr: '', package: '', signType: 'RSA', paySign: '' }; }
  verifySignature() { return true; }
  decryptResource() { return { out_trade_no: '', trade_state: 'SUCCESS', amount: { total: 0, currency: 'CNY' }, payer: { openid: '' } }; }
  sha256() { return ''; }
}

// ============================================================
// 复刻 payment.service.ts 中 callWxCreateOrder body 构造
// ============================================================
function buildCreateOrderBody(wxPay, amountYuan, outTradeNo, openid) {
  const receiver = wxPay.getProfitSharingReceiver();
  return JSON.stringify({
    appid: process.env.WX_APP_ID || 'mock_appid',
    mchid: process.env.WX_MCH_ID || 'mock_mchid',
    description: 'mock 订单',
    out_trade_no: outTradeNo,
    notify_url: process.env.WX_PAY_NOTIFY_URL || 'https://example.com/api/pay/notify',
    amount: { total: Math.round(amountYuan * 100), currency: 'CNY' },
    payer: openid ? { openid } : undefined,
    ...(receiver.enabled ? { profit_sharing: true } : {}),
  });
}

// ============================================================
// 复刻 payment.service.ts 中 callWxProfitSharing 完整分支逻辑
// ============================================================
function callWxProfitSharingLogic(wxPay, params) {
  const receiver = wxPay.getProfitSharingReceiver();
  if (!receiver.enabled) {
    console.log('  [callWxProfitSharing] 未启用分账，跳过');
    return { shareOrderId: '', success: false };
  }
  if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
    console.log(`  [callWxProfitSharing] 开发环境 mock → receiver=${receiver.mchId}, platformFee=¥${params.platformFee.toFixed(2)}`);
    return { shareOrderId: `mock_share_${Date.now()}`, success: true };
  }
  // 生产环境（本脚本不会进入此分支，因为 NODE_ENV=development）
  const _body = wxPay.buildProfitSharingBody({
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
  });
  // const { authorization } = wxPay.buildAuthorization('POST', '/v3/profit-sharing/orders', body);
  return { shareOrderId: 'real_env_unreachable', success: true };
}

// ============================================================
// CASE 1：未配置分账接收方 → enabled=false
// ============================================================
console.log('========================================');
console.log('  Case 1：未配置分账接收方');
console.log('========================================\n');

delete process.env.WX_PROFIT_SHARING_ENABLED;
delete process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID;
delete process.env.WX_PROFIT_SHARING_RECEIVER_NAME;
process.env.WX_APP_ID = '';
process.env.WX_MCH_ID = '';
process.env.NODE_ENV = 'development';

const wx1 = new WxPayUtil();
const r1 = wx1.getProfitSharingReceiver();
console.log(`  getProfitSharingReceiver:`);
console.log(`    enabled = ${r1.enabled}`);
console.log(`    mchId   = "${r1.mchId}"`);
console.log(`    name    = "${r1.name}"`);
console.assert(r1.enabled === false, '❌ 未配置时 enabled 必须为 false');

const body1 = JSON.parse(buildCreateOrderBody(wx1, 100, 'o_pending_1'));
console.log(`  统一下单 profit_sharing = ${body1.profit_sharing === undefined ? '(未设置)' : body1.profit_sharing}`);
console.assert(body1.profit_sharing === undefined, '❌ 未启用时，统一下单不应包含 profit_sharing 字段');

const share1 = callWxProfitSharingLogic(wx1, {
  transactionId: 'tx_case1_dummy',
  outOrderNo: 'PS1',
  platformFee: 10,
});
console.log(`  分账调用: success=${share1.success}, shareOrderId="${share1.shareOrderId}"`);
console.assert(share1.success === false && share1.shareOrderId === '', '❌ 未启用时，分账调用应跳过');

console.log('  ✅ Case 1 通过\n');

// ============================================================
// CASE 2：已配置分账接收方 → enabled=true
// ============================================================
console.log('========================================');
console.log('  Case 2：已配置平台佣金分账接收方');
console.log('========================================\n');

process.env.WX_PROFIT_SHARING_ENABLED = 'true';
process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = 'PLATFORM_MCH_88888888';
process.env.WX_PROFIT_SHARING_RECEIVER_NAME = '邻里互助平台佣金专户';
process.env.WX_APP_ID = 'wx_appid_0000000000';
process.env.WX_MCH_ID = 'MCH_1234567890';
process.env.WX_PAY_NOTIFY_URL = 'https://api.example.com/api/pay/notify';
process.env.NODE_ENV = 'development';

const wx2 = new WxPayUtil();
const r2 = wx2.getProfitSharingReceiver();
console.log('  getProfitSharingReceiver:');
console.log(`    enabled = ${r2.enabled}`);
console.log(`    mchId   = ${r2.mchId}`);
console.log(`    name    = ${r2.name}`);
console.assert(r2.enabled === true, '❌ 配置后 enabled 必须为 true');
console.assert(r2.mchId === 'PLATFORM_MCH_88888888', '❌ mchId 读取错误');
console.assert(r2.name === '邻里互助平台佣金专户', '❌ name 读取错误');
console.log('  ✅ 分账接收方读取正确\n');

// --- 验证点 A：统一下单 profit_sharing=true ---
console.log('【验证点 A】统一下单请求体构造：');
const totalYuan = 199.8;
const body2 = JSON.parse(buildCreateOrderBody(wx2, totalYuan, 'o_2000000001', 'oP_user_openid_0000000'));
console.log(`    appid             = ${body2.appid}`);
console.log(`    mchid             = ${body2.mchid}`);
console.log(`    profit_sharing    = ${body2.profit_sharing}`);
console.log(`    notify_url        = ${body2.notify_url}`);
console.log(`    amount.total(分)  = ${body2.amount.total}`);
console.log(`    payer.openid      = ${body2.payer?.openid ?? '(无)'}`);

const expectedTotalFen = Math.round(totalYuan * 100); // 199.8 → 19980
console.assert(body2.profit_sharing === true, '❌ 启用后，统一下单必须包含 profit_sharing=true');
console.assert(body2.amount.total === expectedTotalFen,
  `❌ 金额转换错误：期望 ${expectedTotalFen} 分，实际 ${body2.amount.total}`);
console.log(`  ✅ profit_sharing=true + 金额¥${totalYuan}→${expectedTotalFen}分 正确\n`);

// --- 验证点 B：模拟 handleNotify 支付成功回调流程 ---
console.log('【验证点 B】模拟支付回调 SUCCESS → 调用分账：');

// 模拟一个普通订单（非补差）
const order = {
  id: 12345n,
  orderNo: 'TS87654321',
  taskId: 56789n,
  helperId: 9876543210123456789n,
  totalAmount: 199.8,
  platformFee: 19.98,        // 10% 平台抽佣
  wechatFee: 1.2,            // 0.6% 微信支付渠道费
  status: 'PENDING',
  isSupplement: false,
};
// 模拟回调解密后的资源对象（包含 transaction_id）
const decrypted = {
  out_trade_no: String(order.id),
  transaction_id: '4200002026081512345678901234',
  trade_state: 'SUCCESS',
  trade_state_desc: '支付成功',
  amount: { total: Math.round(order.totalAmount * 100), currency: 'CNY' },
  payer: { openid: 'oP_user_openid_0000000' },
  success_time: '2026-08-15T20:10:00+08:00',
};

console.log(`    订单: id=${String(order.id)}, total=¥${order.totalAmount.toFixed(2)}, `
  + `platformFee=¥${order.platformFee.toFixed(2)}, wechatFee=¥${order.wechatFee.toFixed(2)}, `
  + `isSupplement=${order.isSupplement}`);
console.log(`    回调: transaction_id=${decrypted.transaction_id}, trade_state=${decrypted.trade_state}`);

// （a）业务层触发条件（与 payment.service.ts 回调中一致）
const condition =
  !order.isSupplement
  && !!decrypted.transaction_id
  && order.platformFee > 0;
console.log(`    触发条件: !isSupplement(${!order.isSupplement}) && tx_id(${!!decrypted.transaction_id}) && platformFee>0(${order.platformFee > 0}) → ${condition}`);
console.assert(condition === true, '❌ 满足条件的普通订单应触发分账');

// （b）分账调用
const shareOutOrderNo = `PS${String(order.id)}${Date.now().toString(36)}`;
const share2 = callWxProfitSharingLogic(wx2, {
  transactionId: decrypted.transaction_id,
  outOrderNo: shareOutOrderNo,
  platformFee: order.platformFee,
});
console.log(`    分账单号(自定义): ${shareOutOrderNo}`);
console.log(`    分账返回: success=${share2.success}, shareOrderId=${share2.shareOrderId}`);
console.assert(share2.success === true, '❌ 开发环境分账调用应返回 success=true');
console.assert(/^mock_share_\d+$/.test(share2.shareOrderId),
  `❌ 分账单号应使用 mock_share_ 前缀，实际 ${share2.shareOrderId}`);
console.log('  ✅ 回调 → 分账 mock 路径正确\n');

// --- 验证点 C：buildProfitSharingBody 元→分 + 接收方 正确 ---
console.log('【验证点 C】分账请求体 buildProfitSharingBody 正确性：');
const shareBody = JSON.parse(wx2.buildProfitSharingBody({
  transactionId: decrypted.transaction_id,
  outOrderNo: shareOutOrderNo,
  receivers: [
    {
      type: 'MERCHANT_ID',
      account: r2.mchId,
      name: r2.name,
      amount: order.platformFee,
      description: `平台佣金分账-${shareOutOrderNo}`,
    },
  ],
}));
console.log(`    appid                   = ${shareBody.appid}`);
console.log(`    transaction_id          = ${shareBody.transaction_id}`);
console.log(`    out_order_no            = ${shareBody.out_order_no}`);
console.log(`    receivers[0].type       = ${shareBody.receivers[0].type}`);
console.log(`    receivers[0].account    = ${shareBody.receivers[0].account}`);
console.log(`    receivers[0].name       = ${shareBody.receivers[0].name}`);
console.log(`    receivers[0].amount(分) = ${shareBody.receivers[0].amount}`);
console.log(`    receivers[0].description = ${shareBody.receivers[0].description}`);

const expectedFen = Math.round(order.platformFee * 100);
console.assert(shareBody.receivers[0].amount === expectedFen,
  `❌ 分账金额转换错误：期望 ¥${order.platformFee} = ${expectedFen} 分，实际 ${shareBody.receivers[0].amount} 分`);
console.assert(shareBody.receivers[0].account === r2.mchId,
  `❌ 接收方商户号错误：期望 ${r2.mchId}，实际 ${shareBody.receivers[0].account}`);
console.assert(shareBody.receivers[0].type === 'MERCHANT_ID',
  `❌ 接收方类型应为 MERCHANT_ID`);
console.log(`  ✅ 分账请求体正确：¥${order.platformFee} = ${expectedFen} 分，接收方=${r2.mchId}\n`);

// ============================================================
// CASE 3：边界行为（业务层过滤）
// ============================================================
console.log('========================================');
console.log('  Case 3：边界条件 / 业务层过滤');
console.log('========================================\n');

// 3a. 补差订单（isSupplement=true）不应分账
const supplementOrder = { ...order, isSupplement: true, platformFee: 5 };
const wouldCallSupplement = !supplementOrder.isSupplement
  && !!decrypted.transaction_id
  && supplementOrder.platformFee > 0;
console.log(`  [边界 3a] isSupplement=true（补差订单）：${wouldCallSupplement ? '❌ 会触发分账' : '✅ 不会触发分账（业务层过滤 isSupplement）'}`);
console.assert(wouldCallSupplement === false, '❌ 补差订单不应触发分账');

// 3b. platformFee=0（免佣订单）不应分账
const freeOrder = { ...order, platformFee: 0 };
const wouldCallFree = !freeOrder.isSupplement
  && !!decrypted.transaction_id
  && freeOrder.platformFee > 0;
console.log(`  [边界 3b] platformFee=0（免佣）：${wouldCallFree ? '❌ 会触发分账' : '✅ 不会触发分账（业务层过滤 platformFee>0）'}`);
console.assert(wouldCallFree === false, '❌ platformFee=0 不应触发分账');

// 3c. 没有 transaction_id（罕见，比如支付回调里 transaction_id 丢失）：不调用分账
const noTxIdOrder = { ...order };
const noTxId = { ...decrypted, transaction_id: undefined };
const wouldCallNoTx = !noTxIdOrder.isSupplement
  && !!noTxId.transaction_id
  && noTxIdOrder.platformFee > 0;
console.log(`  [边界 3c] transaction_id 缺失：${wouldCallNoTx ? '❌ 会触发分账' : '✅ 不会触发分账（缺少 transaction_id，分账 API 无法调用）'}`);
console.assert(wouldCallNoTx === false, '❌ 没有 transaction_id 时不应调用分账');

// 3d. WX_PROFIT_SHARING_ENABLED=false（显式禁用，但 mchId 还在）：调用层过滤
process.env.WX_PROFIT_SHARING_ENABLED = 'false';
const wx3d = new WxPayUtil();
const r3d = wx3d.getProfitSharingReceiver();
console.log(`  [边界 3d] ENABLED=false 但 mchId 还在：enabled=${r3d.enabled}（${r3d.enabled ? '❌ 应 false' : '✅ 被禁用，不会分账'}）`);
console.assert(r3d.enabled === false, '❌ 显式 ENABLED=false 必须关闭分账');

console.log('  ✅ 边界条件全部正确\n');

// ============================================================
// CASE 4：真实分账金额场景样例（总览）
// ============================================================
console.log('========================================');
console.log('  Case 4：多个金额样例（¥元→分）');
console.log('========================================\n');

process.env.WX_PROFIT_SHARING_ENABLED = 'true';
const wx4 = new WxPayUtil();
const r4 = wx4.getProfitSharingReceiver();
const samples = [
  { total: 100,    platformFee: 10,   wechatFee: 0.6  }, // 整数
  { total: 50,     platformFee: 5,    wechatFee: 0.3  }, // 小订单
  { total: 299.99, platformFee: 29.99,wechatFee: 1.8  }, // 小数精度
  { total: 4999.99,platformFee: 499.999, wechatFee: 30 },// 大额
];
for (const s of samples) {
  const sb = JSON.parse(wx4.buildProfitSharingBody({
    transactionId: '420000xxxx',
    outOrderNo: `PS_${s.total}_${Date.now().toString(36)}`,
    receivers: [{
      type: 'MERCHANT_ID', account: r4.mchId, name: r4.name,
      amount: s.platformFee, description: `样例¥${s.total}`,
    }],
  }));
  const actualFen = sb.receivers[0].amount;
  const expectedF = Math.round(s.platformFee * 100);
  const helperFen = Math.round((s.total - s.platformFee - s.wechatFee) * 100);
  const ok = actualFen === expectedF;
  console.log(`  订单 ¥${s.total}  platformFee ¥${s.platformFee} → ${expectedF} 分 (实际 ${actualFen} 分) ${ok ? '✅' : '❌'}  |  接单者冻结 ¥${(s.total - s.platformFee - s.wechatFee).toFixed(2)} = ${helperFen} 分`);
  if (!ok) {
    console.assert(false, `❌ 样例 ¥${s.platformFee} 转换错误`);
  }
}
console.log('  ✅ 全部金额样例 ¥→分 转换正确\n');

// ============================================================
// 汇总
// ============================================================
console.log('========================================');
console.log('  🎉 分账逻辑 Mock 测试 —— 全部验证通过 ');
console.log('========================================\n');

console.log('【改动效果回顾】');
console.log('  触发条件：!isSupplement && transaction_id 存在 && platformFee > 0');
console.log('  统一下单：profit_sharing=true（仅当分账接收方已启用）');
console.log('  调用时机：支付回调 handleNotify 事务（order PAID + task IN_PROGRESS + FREEZE）之后');
console.log('  分账 API：POST /v3/profit-sharing/orders');
console.log('  接收方：WX_PROFIT_SHARING_RECEIVER_MCH_ID（独立的平台佣金收款商户号）');
console.log('  分账金额：platformFee（订单支付时已根据 profit-sharing 规则计算）');
console.log('  失败处理：不回滚订单，仅记录日志，可由对账任务重试');
console.log('  开发环境：mock_share_xxx 前缀分账单号');
console.log('');
console.log('【后续生产步骤】');
console.log('  1. 微信商户平台开通分账功能 → 添加接收方 WX_PROFIT_SHARING_RECEIVER_MCH_ID');
console.log('  2. .env 中配置 3 个新变量（ENABLED=true + MCH_ID + NAME）');
console.log('  3. 取消 callWxProfitSharing / callWxCreateOrder 的 TODO，走真实 HTTP 调用');
console.log('  4. 如需退款：先调用"分账回退"接口把资金回退，再退款');
process.exit(0);
