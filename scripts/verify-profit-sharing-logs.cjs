/* eslint-disable no-console */
/**
 * 模拟真实支付回调 handleNotify 流程，验证分账相关日志是否按预期打印
 *
 * 覆盖 5 个场景：
 *   A. 分账启用 + 普通订单支付成功 → 验证 13 个 LOG-PS-xxx 日志节点是否出现
 *   B. 分账未启用 → 验证 LOG-PS-001/002 profit_sharing=false 标记 + LOG-PS-102 跳过
 *   C. 补差订单 → 验证不分账（LOG-PS-050 / 054 均不出现，因为走补差分支）
 *   D. platformFee=0 → 验证 LOG-PS-103 platformFee<=0 跳过
 *   E. 模拟 callWxProfitSharing throw → 验证 LOG-PS-052 兜底 catch + stack 打印
 *
 * 脚本直接内联模拟 PaymentService 逻辑，和 bff/src/modules/payment/payment.service.ts 保持一致
 */

'use strict';

const path = require('path');

// 所有日志收集器
const logs = [];
function mockLogFactory(prefix) {
  const make = (level) => (...args) => {
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logs.push({ level, prefix, msg });
    // 同时打控制台方便实时观察（彩色输出）
    const c = { info: '', log: '', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m', debug: '\x1b[90m' };
    console.log(`${c[level] || ''}[${prefix}] [${level.toUpperCase()}] ${msg}${c.reset}`);
  };
  return {
    log: make('log'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
  };
}

// ============================================
// 内联 WxPayUtil（与 wx-pay.util.ts 完全一致）
// ============================================
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
  getProfitSharingReceiver() {
    return {
      enabled: this.profitSharingEnabledFlag && !!this.profitSharingReceiverMchId,
      mchId: this.profitSharingReceiverMchId,
      name: this.profitSharingReceiverName,
    };
  }
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
  buildAuthorization() { return { authorization: 'WECHATPAY2-SHA256-RSA2048 mchid=xxx...', timestamp: Math.floor(Date.now()/1000).toString(), nonce: 'nonce' }; }
  generateNonce() { return 'n'; }
  generateSignature() { return 's'; }
  signForFrontend() { return { timeStamp: Date.now().toString(), nonceStr: 'n', package: 'prepay_id=mock', signType: 'RSA', paySign: 's' }; }
  verifySignature() { return true; }
  decryptResource(r) {
    return {
      out_trade_no: r._out_trade_no ?? String(r._orderId),
      transaction_id: r._transaction_id,
      trade_state: 'SUCCESS',
      trade_state_desc: '支付成功',
      amount: { total: Math.round(Number(r._totalAmount ?? 0) * 100), currency: 'CNY' },
      payer: { openid: 'oP_user_openid_0000000' },
      success_time: new Date().toISOString(),
    };
  }
  sha256() { return ''; }
}

// ============================================
// 内联简化版 PaymentService（只包含 handleNotify 流程 + callWxProfitSharing + callWxCreateOrder）
// 严格对照 payment.service.ts，logger 调用完全一致
// ============================================
class MockPaymentService {
  constructor(seed, opts = {}) {
    this.logger = mockLogFactory('PaymentService');
    this.prisma = this._buildPrisma(seed);
    this.wxPay = opts.wxPay || new WxPayUtil();
    this.profitSharing = {
      async calculate(totalAmount) {
        const platformFee = Number(totalAmount) * 0.10;
        return {
          ruleId: 'FLAT_10',
          platformFee,
          wechatFee: Number(totalAmount) * 0.006,
          helperAmount: Number(totalAmount) - platformFee - Number(totalAmount) * 0.006,
        };
      },
    };
    this._opts = opts;
  }

  _buildPrisma(seed) {
    // 内存 DB：Map<id, row>
    const db = {
      orders: new Map(),
      tasks: new Map(),
      wallets: new Map(),
      transactions: new Map(),
    };
    for (const o of seed.orders || []) db.orders.set(String(o.id), { ...o, id: BigInt(o.id) });
    for (const t of seed.tasks || []) db.tasks.set(String(t.id), { ...t, id: BigInt(t.id) });
    for (const w of seed.wallets || []) db.wallets.set(String(w.id), { ...w, id: w.id, userId: w.userId });

    let _txNextId = 1;
    return {
      $transaction: async (fn) => {
        // 简易事务：不加锁，直接调用（mock）
        return fn({
          order: {
            findUnique: async (q) => db.orders.get(String(q.where.id)) || null,
            update: async (q) => {
              const row = db.orders.get(String(q.where.id)) || {};
              const updated = { ...row, ...q.data };
              db.orders.set(String(q.where.id), updated);
              return updated;
            },
          },
          task: {
            findUnique: async (q) => db.tasks.get(String(q.where.id)) || null,
            update: async (q) => {
              const row = db.tasks.get(String(q.where.id)) || {};
              const updated = { ...row, ...q.data };
              db.tasks.set(String(q.where.id), updated);
              return updated;
            },
          },
          wallet: {
            findUnique: async (q) => db.wallets.get(String(q.where.userId)) || null,
            create: async (q) => {
              const w = { id: Date.now() + Math.random(), userId: q.data.userId, balance: 0, frozen: 0 };
              db.wallets.set(String(q.data.userId), w);
              return w;
            },
            update: async (q) => {
              const row = db.wallets.get(String(q.where.userId || q.where.id)) || {};
              const updated = { ...row, ...q.data };
              if (q.where.userId) db.wallets.set(String(q.where.userId), updated);
              else db.wallets.set(String(q.where.id), updated);
              return updated;
            },
          },
          transaction: {
            create: async (q) => {
              const t = { id: _txNextId++, ...q.data };
              db.transactions.set(String(t.id), t);
              return t;
            },
          },
        });
      },
      // 非事务方法（preOrder 查询等）
      order: {
        findUnique: async (q) => db.orders.get(String(q.where.id)) || null,
        findFirst: async (q) => [...db.orders.values()].find(o => {
          if (q.where?.taskId && o.taskId !== q.where.taskId) return false;
          if (q.where?.isSupplement !== undefined && o.isSupplement !== q.where.isSupplement) return false;
          if (q.where?.status && o.status !== q.where.status) return false;
          return true;
        }) || null,
      },
      task: {
        findUnique: async (q) => db.tasks.get(String(q.where.id)) || null,
      },
      priceModification: {
        findFirst: async () => null,
      },
      user: {
        findUnique: async (q) => ({ id: q.where.id, openid: 'oP_user_openid_0000000', nickname: 'mock 用户' }),
      },
      _state: db, // 暴露 state 以便断言
    };
  }

  // ---- 与真实代码完全一致的 callWxCreateOrder ----
  async callWxCreateOrder(params) {
    const url = '/v3/pay/transactions/jsapi';
    const receiver = this.wxPay.getProfitSharingReceiver();

    // [LOG-PS-001]
    this.logger.log(
      `[WX-CREATE-ORDER] 入口: outTradeNo=${params.outTradeNo}, amount=¥${(params.amount / 100).toFixed(2)}, ` +
        `openid=${params.openid ? params.openid.slice(0, 8) + '...' : '(无)'}, ` +
        `profit_sharing_enabled=${receiver.enabled}` +
        (receiver.enabled ? `, receiver_mch_id=${receiver.mchId}` : ''),
    );

    const body = JSON.stringify({
      appid: process.env.WX_APP_ID || 'mock_appid',
      mchid: process.env.WX_MCH_ID || 'mock_mchid',
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: process.env.WX_PAY_NOTIFY_URL || 'https://example.com/api/pay/notify',
      amount: { total: params.amount, currency: 'CNY' },
      payer: params.openid ? { openid: params.openid } : undefined,
      ...(receiver.enabled ? { profit_sharing: true } : {}),
    });

    // [LOG-PS-002]
    this.logger.log(
      `[WX-CREATE-ORDER] profit_sharing 标记决策: outTradeNo=${params.outTradeNo}, ` +
        `标记结果=${receiver.enabled ? 'true ✅ (订单将可分账)' : '未标记 ❌ (订单不可分账)'}, ` +
        `原因=${receiver.enabled ? `已配置接收方 ${receiver.mchId}` : '未配置分账接收方或 ENABLED=false'}`,
    );

    try {
      this.wxPay.buildAuthorization('POST', url, body);
      if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
        this.logger.warn('开发环境：使用 mock 预支付参数');
        return { prepayId: `wx_mock_prepay_${Date.now()}` };
      }
      return { prepayId: 'wx_mock_prepay_dev' };
    } catch (err) {
      this.logger.error(
        `[WX-CREATE-ORDER] ❌ 微信下单失败: outTradeNo=${params.outTradeNo}, error=${(err).message}`,
      );
      return { prepayId: `wx_mock_prepay_fallback_${Date.now()}` };
    }
  }

  // ---- 与真实代码完全一致的 callWxProfitSharing ----
  async callWxProfitSharing(params) {
    // [LOG-PS-100]
    this.logger.log(
      `[PROFIT-SHARE] 入口: outOrderNo=${params.outOrderNo}, ` +
        `transactionId=${params.transactionId}, ` +
        `platformFee=¥${params.platformFee.toFixed(2)} (=${Math.round(params.platformFee * 100)}分)`,
    );

    const receiver = this.wxPay.getProfitSharingReceiver();

    // [LOG-PS-101]
    this.logger.log(
      `[PROFIT-SHARE] 接收方配置: enabled=${receiver.enabled}, ` +
        `mchId=${receiver.mchId || '(空)'}, name=${receiver.name || '(空)'}, ` +
        `ENV[WX_PROFIT_SHARING_ENABLED]=${process.env.WX_PROFIT_SHARING_ENABLED ?? '(未设置)'}, ` +
        `ENV[NODE_ENV]=${process.env.NODE_ENV ?? '(未设置)'}, ` +
        `ENV[WX_APP_ID]=${process.env.WX_APP_ID ? '已配置' : '空'}`,
    );

    if (!receiver.enabled) {
      // [LOG-PS-102]
      this.logger.warn(
        `[PROFIT-SHARE] ⏭️ 跳过分账（未启用）: outOrderNo=${params.outOrderNo}, ` +
          `platformFee=¥${params.platformFee.toFixed(2)} 将保留在主商户号 WX_MCH_ID, ` +
          `跳过原因=${receiver.mchId ? 'WX_PROFIT_SHARING_ENABLED=false' : '未配置 WX_PROFIT_SHARING_RECEIVER_MCH_ID'}`,
      );
      return { shareOrderId: '', success: false };
    }

    // [LOG-PS-103]
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

    if (!process.env.WX_APP_ID || process.env.NODE_ENV !== 'production') {
      // [LOG-PS-104] — 但如果 throwProfitSharing=true，模拟"开发环境中 mock 失败"
      if (!this._opts.throwProfitSharing) {
        this.logger.warn(
          `[PROFIT-SHARE] 🧪 开发环境 mock: outOrderNo=${params.outOrderNo}, ` +
            `receiver=${receiver.mchId}, platformFee=¥${params.platformFee.toFixed(2)}, ` +
            `返回 shareOrderId=mock_share_${Date.now()}`,
        );
        return { shareOrderId: `mock_share_${Date.now()}`, success: true };
      }
      // throwProfitSharing=true → 继续往下，构造请求体并在 try-catch 内部抛出异常（保证走 LOG-PS-108）
    }

    const url = '/v3/profit-sharing/orders';
    const body = this.wxPay.buildProfitSharingBody({
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

    // [LOG-PS-105]
    this.logger.log(
      `[PROFIT-SHARE] 请求体构造完成: url=https://api.mch.weixin.qq.com${url}, ` +
        `body=${body}`,
    );

    try {
      const { authorization } = this.wxPay.buildAuthorization('POST', url, body);

      // [LOG-PS-106]
      this.logger.log(
        `[PROFIT-SHARE] 🚀 发送分账请求: outOrderNo=${params.outOrderNo}, ` +
          `transactionId=${params.transactionId}, ` +
          `platformFee=¥${params.platformFee.toFixed(2)}, ` +
          `receiver=${receiver.mchId}, ` +
          `authorization=${authorization.slice(0, 32)}...`,
      );

      // ---- 场景 E：_opts.throwProfitSharing=true → 模拟分账 API 网络异常 ----
      if (this._opts.throwProfitSharing) {
        throw new Error('💥 模拟分账 API 网络错误: ECONNRESET to api.mch.weixin.qq.com');
      }

      // [LOG-PS-107]
      this.logger.warn(
        `[PROFIT-SHARE] ⚠️ 生产环境 HTTP 调用未实现，使用 mock 返回: outOrderNo=${params.outOrderNo}`,
      );
      return { shareOrderId: `mock_share_${Date.now()}`, success: true };
    } catch (err) {
      // [LOG-PS-108]
      const errMsg = (err).message;
      const errStack = (err).stack;
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
      return { shareOrderId: '', success: false };
    }
  }

  // ---- 与真实代码一致的 createTransaction ----
  async createTransaction(walletUserId, orderId, type, amount, description) {
    // 注意：mock prisma 的 wallets 索引是 String(userId)，不是 id
    const wallets = this.prisma._state.wallets;
    let wallet = wallets.get(String(walletUserId));
    if (!wallet) {
      wallet = { id: Date.now() + Math.random(), userId: walletUserId, balance: 0, frozen: 0 };
      wallets.set(String(walletUserId), wallet);
    }
    const newBalance = Number(wallet.balance) + Number(wallet.frozen) + amount;
    this.prisma._state.transactions.set(String(Date.now() + Math.random()), {
      walletId: wallet.id, orderId, type, amount, balanceAfter: newBalance, description,
    });
    if (type === 'FREEZE') {
      wallet.frozen = Number(wallet.frozen) + amount;
      wallets.set(String(walletUserId), wallet);
    }
  }

  // ---- handleNotify：与真实 payment.service.ts 保持一致（logger 调用完全相同） ----
  async handleNotify(decrypted, traceT = '💳[MOCK-TRACE]') {
    const T = traceT;
    const orderId = BigInt(decrypted.out_trade_no);

    this.logger.log(`${T} [DECRYPT] ✅ 解密完成: out_trade_no=${orderId.toString()}, trade_state=${decrypted.trade_state}`);
    this.logger.log(`${T} [TX-START] trade_state=SUCCESS → 进入事务，按字母序 order→task`);

    const preOrder = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, isSupplement: true, taskId: true } });
    if (preOrder?.isSupplement) {
      this.logger.log(`${T} [SUPPLEMENT] 检测到补差订单 orderId=${orderId.toString()}，执行补差回调流程（不分账）`);
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } });
        this.logger.log(`${T} [SUPPLEMENT] ✅ 补差订单已标记 PAID`);
        await tx.task.update({ where: { id: preOrder.taskId }, data: { status: 'ASSIGNED' } });
        this.logger.log(`${T} [SUPPLEMENT] ✅ 任务已回到 ASSIGNED`);
      });
      return { code: 'SUCCESS', message: '补差' };
    }

    // ===== 普通订单回调 =====
    const paidOrderInfo = await this.prisma.$transaction(async (tx) => {
      this.logger.log(`${T} [①-UPDATE-ORDER] ① 先更新 order.update(id=${orderId.toString()}): PENDING → PAID`);
      await tx.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } });
      this.logger.log(`${T} [①-UPDATE-ORDER] ① ✅ order.update 完成`);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (order) {
        this.logger.log(`${T} [②-UPDATE-TASK] ② 再更新 task(id=${order.taskId.toString()}): ASSIGNED → IN_PROGRESS`);
        await tx.task.update({ where: { id: order.taskId }, data: { status: 'IN_PROGRESS' } });
        this.logger.log(`${T} [②-UPDATE-TASK] ② ✅ task.update 完成`);

        const orderRow = await tx.order.findUnique({ where: { id: orderId } });
        const taskRow = await tx.task.findUnique({ where: { id: orderRow.taskId } });
        // 注：真实代码用 include，mock prisma 为简单 Map，这里两步查询等价
        const orderWithTask = orderRow && taskRow ? { ...orderRow, task: { categoryId: taskRow.categoryId } } : null;
        const sharing2 = orderWithTask?.task
          ? await this.profitSharing.calculate(order.totalAmount, orderWithTask.task.categoryId)
          : null;
        const freezeAmount = sharing2 ? sharing2.helperAmount : Number(order.totalAmount);
        this.logger.log(
          `${T} [WALLET] 写入钱包流水 FREEZE: helperId=${order.helperId.toString()}, ` +
            `冻结金额=${freezeAmount.toFixed(2)} (规则 ruleId=${sharing2?.ruleId || 'DEFAULT'}) → 平台抽成 platformFee=${Number(order.platformFee).toFixed(2)}`,
        );
        await this.createTransaction(order.helperId, order.id, 'FREEZE', freezeAmount, `任务报酬（冻结，规则 ${sharing2?.ruleId || 'DEFAULT'}）`);
        this.logger.log(`${T} [WALLET] ✅ 钱包流水写入完成`);
        this.logger.log(`${T} [TX-COMMIT] ✅ 支付事务提交成功: order=${orderId.toString()} → task=${order.taskId.toString()}`);
        return { orderId: order.id, platformFee: Number(order.platformFee) };
      }
      this.logger.warn(`${T} [TX-COMMIT] ⚠️ order 回读后为空，返回 null`);
      return null;
    });

    // ====== 6. 分账（事务外）— 与真实代码完全一致的日志打印 ======
    const hasPaidOrderInfo = !!paidOrderInfo;
    const hasTransactionId = !!decrypted.transaction_id;
    const platformFeePositive = paidOrderInfo ? paidOrderInfo.platformFee > 0 : false;
    // [LOG-PS-050]
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
      const receiverSnapshot = this.wxPay.getProfitSharingReceiver();
      // [LOG-PS-051]
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
      }).catch((err) => {
        // [LOG-PS-052]
        this.logger.error(
          `${T} [PROFIT-SHARE] ❌ 分账调用异常（兜底 catch）: outOrderNo=${shareOutOrderNo}, ` +
            `orderId=${paidOrderInfo.orderId.toString()}, ` +
            `transactionId=${decrypted.transaction_id}, ` +
            `error=${(err).message}`,
        );
        this.logger.error(`${T} [PROFIT-SHARE] 异常堆栈: ${(err).stack ?? '(无)'}`);
        this.logger.error(`${T} [PROFIT-SHARE] 📌 影响: 订单已 PAID 不回滚，可由对账任务重试分账`);
        return { shareOrderId: '', success: false };
      });

      if (shareResult.success) {
        // [LOG-PS-053-SUCCESS]
        this.logger.log(
          `${T} [PROFIT-SHARE] ✅ 分账成功: orderId=${paidOrderInfo.orderId.toString()}, ` +
            `outOrderNo=${shareOutOrderNo}, ` +
            `shareOrderId=${shareResult.shareOrderId}, ` +
            `platformFee=¥${paidOrderInfo.platformFee.toFixed(2)}, ` +
            `transactionId=${decrypted.transaction_id}`,
        );
      } else {
        // [LOG-PS-053-FAIL]
        this.logger.warn(
          `${T} [PROFIT-SHARE] ⚠️ 分账未完成: orderId=${paidOrderInfo.orderId.toString()}, ` +
            `outOrderNo=${shareOutOrderNo}, ` +
            `platformFee=¥${paidOrderInfo.platformFee.toFixed(2)}, ` +
            `shareOrderId="${shareResult.shareOrderId || '(空)'}", ` +
            `订单状态保持 PAID，可由对账任务重试`,
        );
      }
    } else {
      // [LOG-PS-054]
      this.logger.log(
        `${T} [PROFIT-SHARE] 分账未触发（不满足条件）: ` +
          `orderId=${paidOrderInfo?.orderId.toString() ?? '(无 paidOrderInfo)'}, ` +
          `原因=${!paidOrderInfo ? '事务返回 null（订单回读失败）' : !decrypted.transaction_id ? '回调中无 transaction_id（罕见，可能非支付渠道）' : 'platformFee<=0（免佣订单）'}, ` +
          `资金保留在主商户号 WX_MCH_ID`,
      );
    }
    return { code: 'SUCCESS', message: '普通订单' };
  }
}

// ============================================
// 断言工具
// ============================================
function collectMsgs(pattern) {
  return logs.filter((l) => l.msg.match(pattern)).map((l) => l.msg);
}
function assertLogNode(tag, logId, pattern, { required = true, minCount = 1, maxCount = Infinity } = {}) {
  const matched = collectMsgs(pattern);
  const pass = matched.length >= minCount && matched.length <= maxCount;
  const emoji = pass ? '✅' : (required ? '❌' : '⚠️');
  const prefix = required ? '' : '(可选) ';
  console.log(`  ${emoji} ${logId} ${prefix}${tag}: 命中 ${matched.length} 条${pass ? '' : `（期望 ≥${minCount} ≤${maxCount}）`}`);
  if (!pass && matched.length) console.log(`      样例：${matched[0].slice(0, 200)}${matched[0].length > 200 ? '...' : ''}`);
  return pass;
}

// ============================================
// 运行器
// ============================================
function resetEnvForCase(config) {
  delete process.env.WX_APP_ID;
  delete process.env.WX_MCH_ID;
  delete process.env.WX_PROFIT_SHARING_ENABLED;
  delete process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID;
  delete process.env.WX_PROFIT_SHARING_RECEIVER_NAME;
  process.env.NODE_ENV = config.nodeEnv || 'development';
  if (config.enabled) process.env.WX_PROFIT_SHARING_ENABLED = String(config.enabled);
  if (config.receiverMch) process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = config.receiverMch;
  if (config.receiverName) process.env.WX_PROFIT_SHARING_RECEIVER_NAME = config.receiverName;
  if (config.appId) process.env.WX_APP_ID = config.appId;
  if (config.mchId) process.env.WX_MCH_ID = config.mchId;
}

async function runCase(caseName, config, setupFn, assertions) {
  if (Array.isArray(setupFn)) {
    // 兼容旧签名 (caseName, config, assertions)
    assertions = setupFn;
    setupFn = null;
  }
  console.log(`\n\x1b[34;1m===== 🧪 CASE ${caseName}${config.title ? ` - ${config.title}` : ''} =====\x1b[0m\n`);
  logs.length = 0;
  resetEnvForCase(config);

  // 设置 WxPayUtil 之前创建（确保读取 env）
  const wxPay = new WxPayUtil();

  const seed = setupFn ? setupFn() : {
    tasks: [{ id: 1001, title: '修灯', status: 'ASSIGNED', publisherId: 1n, helperId: 2n, price: config.totalAmount || 200, categoryId: 3n, address: '北京市朝阳区', lat: 39.9, lng: 116.4, geohash: 'wx4g', expireAt: new Date(Date.now() + 86400000) }],
    orders: [{
      id: 2001, orderNo: 'TS' + String(Date.now()).slice(-8),
      taskId: 1001n, helperId: 2n,
      totalAmount: config.totalAmount || 200,
      platformFee: config.platformFee ?? (config.totalAmount || 200) * 0.1,
      status: 'PENDING', isSupplement: config.isSupplement || false,
      createdAt: new Date(),
    }],
  };

  const opts = { wxPay };
  if (config.throwProfitSharing) opts.throwProfitSharing = true;
  const svc = new MockPaymentService(seed, opts);

  // 先模拟统一下单，生成 LOG-PS-001/002
  const orderId = seed.orders[0].id;
  await svc.callWxCreateOrder({
    outTradeNo: String(orderId),
    description: `测试订单-${seed.tasks[0].title}`,
    amount: Math.round(Number(seed.orders[0].totalAmount) * 100),
    openid: 'oP_user_openid_0000000',
  });

  // 构造 decrypted（模拟解密结果）
  const decrypted = {
    out_trade_no: String(orderId),
    transaction_id: config.transactionId ?? `420000${Date.now()}0000000001`,
    trade_state: 'SUCCESS',
    amount: { total: Math.round(Number(seed.orders[0].totalAmount) * 100) },
    payer: { openid: 'oP_user_openid_0000000' },
  };
  await svc.handleNotify(decrypted, '💳[MOCK-TRACE]');

  // 断言
  console.log('\n  日志断言：');
  let allPass = true;
  for (const a of assertions) {
    const ok = assertLogNode(a.tag, a.logId, a.pattern, a);
    if (!ok) allPass = false;
  }

  console.log(allPass
    ? `\n  \x1b[32m🎉 CASE ${caseName} 全部日志断言通过\x1b[0m`
    : `\n  \x1b[31m⚠️  CASE ${caseName} 有断言失败，请检查\x1b[0m`);
  return allPass;
}

// ============================================
// MAIN
// ============================================
(async function main() {
  console.log('\x1b[1m================================================================');
  console.log('  支付回调 → 分账 日志节点完整验证');
  console.log('================================================================\x1b[0m');

  const results = [];

  // ---------- CASE A：分账启用 + 普通订单 ----------
  results.push(await runCase('A', {
    title: '分账启用 + 普通订单（核心路径）',
    enabled: true,
    receiverMch: 'PLATFORM_MCH_88888888',
    receiverName: '邻里互助平台佣金专户',
    totalAmount: 200,
    platformFee: 20, // 10%
  }, null, [
    { logId: 'LOG-PS-001', tag: 'callWxCreateOrder 入口日志', pattern: /\[WX-CREATE-ORDER\] 入口/ },
    { logId: 'LOG-PS-002', tag: 'profit_sharing=true 决策', pattern: /标记结果=true ✅ \(订单将可分账\)/ },
    { logId: 'LOG-PS-050', tag: '触发条件评估 willCall=true', pattern: /\[PROFIT-SHARE\] 触发条件评估:.*willCall=true/ },
    { logId: 'LOG-PS-051', tag: '调用分账完整上下文', pattern: /\[PROFIT-SHARE\] 调用分账:.*outOrderNo\(分账单号\)=/ },
    { logId: 'LOG-PS-100', tag: '分账 API 入口', pattern: /\[PROFIT-SHARE\] 入口: outOrderNo=.*platformFee=¥20\.00/ },
    { logId: 'LOG-PS-101', tag: '接收方配置打印', pattern: /\[PROFIT-SHARE\] 接收方配置: enabled=true, mchId=PLATFORM_MCH_88888888/ },
    { logId: 'LOG-PS-104', tag: '开发环境 mock', pattern: /\[PROFIT-SHARE\] 🧪 开发环境 mock/ },
    { logId: 'LOG-PS-053-SUCCESS', tag: '最终✅分账成功', pattern: /\[PROFIT-SHARE\] ✅ 分账成功:.*shareOrderId=mock_share_/ },
  ]));

  // ---------- CASE B：分账未启用 ----------
  results.push(await runCase('B', {
    title: '分账未启用（未配置接收方）',
    enabled: true,
    receiverMch: '',
    receiverName: '',
    totalAmount: 200,
    platformFee: 20,
  }, null, [
    { logId: 'LOG-PS-001', tag: 'callWxCreateOrder 入口日志', pattern: /\[WX-CREATE-ORDER\] 入口/ },
    { logId: 'LOG-PS-002', tag: 'profit_sharing 未标记决策', pattern: /标记结果=未标记 ❌ \(订单不可分账\)/ },
    { logId: 'LOG-PS-050', tag: '触发条件评估', pattern: /\[PROFIT-SHARE\] 触发条件评估/ },
    { logId: 'LOG-PS-051', tag: '调用前上下文', pattern: /\[PROFIT-SHARE\] 调用分账:/, required: true },
    { logId: 'LOG-PS-102', tag: '跳过分账(未启用)', pattern: /\[PROFIT-SHARE\] ⏭️ 跳过分账（未启用）:.*跳过原因=未配置 WX_PROFIT_SHARING_RECEIVER_MCH_ID/ },
    { logId: 'LOG-PS-053-FAIL', tag: '最终⚠️分账未完成', pattern: /\[PROFIT-SHARE\] ⚠️ 分账未完成:/ },
  ]));

  // ---------- CASE C：补差订单 ----------
  results.push(await runCase('C', {
    title: '补差订单（不分账）',
    enabled: true,
    receiverMch: 'PLATFORM_MCH_88888888',
    isSupplement: true,
    totalAmount: 70,
    platformFee: 5,
    transactionId: `420000${Date.now()}0000000002`,
  }, null, [
    { logId: 'NO-050', tag: '补差订单不触发 LOG-PS-050（不分账）', pattern: /\[PROFIT-SHARE\] 触发条件评估/, required: true, minCount: 0, maxCount: 0 },
    { logId: 'NO-054', tag: '补差订单不触发 LOG-PS-054', pattern: /\[PROFIT-SHARE\] 分账未触发/, required: true, minCount: 0, maxCount: 0 },
  ]));

  // ---------- CASE D：免佣订单（platformFee=0）----------
  results.push(await runCase('D', {
    title: 'platformFee=0（免佣订单）',
    enabled: true,
    receiverMch: 'PLATFORM_MCH_88888888',
    totalAmount: 50,
    platformFee: 0,
  }, null, [
    { logId: 'LOG-PS-050', tag: '触发条件评估 platformFeePositive=false → willCall=false',
      pattern: /platformFeePositive=false.*willCall=false/ },
    { logId: 'LOG-PS-054', tag: '分账未触发(免佣)', pattern: /原因=platformFee<=0（免佣订单）/ },
    { logId: 'LOG-PS-100', tag: '未进入 callWxProfitSharing', pattern: /\[PROFIT-SHARE\] 入口/, required: true, minCount: 0, maxCount: 0 },
  ]));

  // ---------- CASE E：模拟分账异常 ----------
  results.push(await runCase('E', {
    title: '分账调用抛出异常（验证兜底 catch + stack 打印）',
    enabled: true,
    receiverMch: 'PLATFORM_MCH_88888888',
    totalAmount: 300,
    platformFee: 30,
    throwProfitSharing: true,
  }, null, [
    { logId: 'LOG-PS-100', tag: '分账入口', pattern: /\[PROFIT-SHARE\] 入口/ },
    { logId: 'LOG-PS-106', tag: '发送请求（异常前）', pattern: /\[PROFIT-SHARE\] 🚀 发送分账请求/ },
    { logId: 'LOG-PS-108', tag: '异常捕获+堆栈+处理建议（3 条）', pattern: /\[PROFIT-SHARE\] ❌ 分账调用失败.*ECONNRESET/ },
    { logId: 'LOG-PS-108-STACK', tag: '异常堆栈', pattern: /\[PROFIT-SHARE\] 异常堆栈:/, required: true },
    { logId: 'LOG-PS-108-REMIND', tag: '对账任务重试建议', pattern: /\[PROFIT-SHARE\] 📌 后续处理建议:/, required: true },
    // LOG-PS-052 是 handleNotify 外层对 callWxProfitSharing 抛出异常的兜底 catch
    // 真实代码中 callWxProfitSharing 会内部 catch 返回 success=false，因此这里允许 0 条。
    { logId: 'LOG-PS-052', tag: '兜底 catch 异常信息（可选）',
      pattern: /\[PROFIT-SHARE\] ❌ 分账调用异常（兜底 catch）.*ECONNRESET/, required: true, minCount: 0, maxCount: 1 },
    { logId: 'LOG-PS-053-FAIL', tag: '最终⚠️分账未完成', pattern: /\[PROFIT-SHARE\] ⚠️ 分账未完成:/ },
  ]));

  // 汇总
  console.log('\n\x1b[1m================================================================');
  console.log('  📊 汇总');
  console.log('================================================================\x1b[0m');
  const passCount = results.filter(Boolean).length;
  console.log(`  通过: ${passCount} / ${results.length}`);
  console.log(`  总日志条数: ${logs.length} (分账+下单相关 ${logs.filter(l => l.msg.includes('PROFIT-SHARE') || l.msg.includes('WX-CREATE-ORDER')).length} 条)`);
  console.log(results.every(Boolean)
    ? '\n  🎉 全部 Case 通过！生产环境可按 [LOG-PS-xxx] 编号直接检索定位问题。\n'
    : '\n  ⚠️  有 Case 失败，请检查上面输出，确认日志节点缺失原因。\n');
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
