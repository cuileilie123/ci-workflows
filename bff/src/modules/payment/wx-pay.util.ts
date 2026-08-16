import { Injectable, Logger } from '@nestjs/common';
import { createSign, createHash, createPublicKey, verify, createDecipheriv } from 'crypto';

/**
 * 微信支付 V3 回调解密后的资源对象
 */
export interface DecryptedResource {
  out_trade_no: string;
  transaction_id?: string;
  trade_state: string;
  trade_state_desc?: string;
  amount: { total: number; currency: string };
  payer: { openid: string };
  settle_total?: number;
  success_time?: string;
}

/**
 * 分账接收方信息
 */
export interface ProfitSharingReceiver {
  /** 是否启用分账（已配置接收方且未被显式禁用） */
  enabled: boolean;
  /** 接收方商户号 */
  mchId: string;
  /** 接收方名称（与微信商户平台登记一致） */
  name: string;
}

/**
 * 分账接收方明细（单个）
 */
export interface ProfitSharingReceiverItem {
  /** 接收方类型：MERCHANT_ID（商户号）或 PERSONAL_OPENID（个人 openid） */
  type: 'MERCHANT_ID' | 'PERSONAL_OPENID';
  /** 接收方账号（商户号或 openid） */
  account: string;
  /** 接收方名称（个人时必填，需加密；商户时可填可不填） */
  name?: string;
  /** 分账金额（元） */
  amount: number;
  /** 分账描述 */
  description: string;
}

/**
 * 分账请求构造参数
 */
export interface ProfitSharingParams {
  /** 微信支付订单号（来自支付回调 transaction_id） */
  transactionId: string;
  /** 商户分账单号（商户自定义，需唯一） */
  outOrderNo: string;
  /** 分账接收方列表 */
  receivers: ProfitSharingReceiverItem[];
}

/**
 * 微信支付 V3 工具类
 * - 签名生成（SHA256withRSA）
 * - 回调验签
 * - 回调报文解密（AES-256-GCM）
 */
@Injectable()
export class WxPayUtil {
  private readonly logger = new Logger(WxPayUtil.name);
  private readonly appId: string;
  private readonly mchId: string;
  private readonly apiV3Key: string;
  private readonly privateKey: string;
  private readonly wxPublicKey: string;
  private readonly profitSharingReceiverMchId: string;
  private readonly profitSharingReceiverName: string;
  private readonly profitSharingEnabledFlag: boolean;

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
   * 获取平台佣金分账接收方配置
   * - enabled=true 时表示已配置独立的平台收款商户号，订单支付成功时将 platformFee 分到该账号
   * - enabled=false 时所有资金停留在 WX_MCH_ID，平台佣金仅在系统内做账
   */
  getProfitSharingReceiver(): ProfitSharingReceiver {
    return {
      enabled: this.profitSharingEnabledFlag && !!this.profitSharingReceiverMchId,
      mchId: this.profitSharingReceiverMchId,
      name: this.profitSharingReceiverName,
    };
  }

  /**
   * 构造分账请求体（POST /v3/profit-sharing/orders）
   * - 金额单位转换为分（微信支付要求）
   * - 默认不分账接收方关系（需在微信商户平台预先添加）
   * - appIdOverride 用于支持老板通过财务设置页覆盖 env.WX_APP_ID（DB > env）
   * @see https://pay.weixin.qq.com/docs/merchant/apis/profit-sharing/allocate-transaction-funds/create-allocate.html
   */
  buildProfitSharingBody(params: ProfitSharingParams, appIdOverride?: string): string {
    return JSON.stringify({
      appid: appIdOverride || this.appId,
      transaction_id: params.transactionId,
      out_order_no: params.outOrderNo,
      receivers: params.receivers.map((r) => ({
        type: r.type,
        account: r.account,
        ...(r.name ? { name: r.name } : {}),
        amount: Math.round(r.amount * 100), // 元 → 分
        description: r.description,
      })),
    });
  }

  /**
   * 生成随机字符串
   */
  generateNonce(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * 微信支付 V3 签名
   * @param method HTTP 方法 GET/POST
   * @param url 请求路径（含查询参数，不含域名）
   * @param body 请求体（GET 为空字符串）
   * @param timestamp 时间戳（秒）
   * @param nonce 随机字符串
   */
  generateSignature(
    method: string,
    url: string,
    body: string,
    timestamp: string,
    nonce: string,
  ): string {
    const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;

    if (!this.privateKey) {
      this.logger.warn('WX_PAY_PRIVATE_KEY 未配置，签名将使用占位符');
      return 'MOCK_SIGNATURE';
    }

    const signer = createSign('SHA256');
    signer.update(message);
    signer.end();
    return signer.sign(this.privateKey, 'base64');
  }

  /**
   * 构造 Authorization 头（WECHATPAY2-SHA256-RSA2048）
   * - mchIdOverride 用于支持老板通过财务设置页覆盖 env.WX_MCH_ID（DB > env）
   *   签名串本身不含 mchid，因此覆盖仅影响 Authorization 头中的 mchid 字段
   */
  buildAuthorization(
    method: string,
    url: string,
    body: string,
    timestamp?: string,
    nonce?: string,
    mchIdOverride?: string,
  ): { authorization: string; timestamp: string; nonce: string } {
    const ts = timestamp || Math.floor(Date.now() / 1000).toString();
    const nc = nonce || this.generateNonce();
    const signature = this.generateSignature(method, url, body, ts, nc);
    const effectiveMchId = mchIdOverride || this.mchId;
    const authorization =
      `WECHATPAY2-SHA256-RSA2048 ` +
      `mchid="${effectiveMchId}",nonce_str="${nc}",signature="${signature}",timestamp="${ts}",serial_no="PLACEHOLDER"`;
    return { authorization, timestamp: ts, nonce: nc };
  }

  /**
   * 验签：验证微信回调签名
   * @param timestamp 时间戳
   * @param nonce 随机串
   * @param body 响应体（JSON 字符串）
   * @param signature 微信签名（来自 wechatpay-signature 头）
   */
  verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
    if (!this.wxPublicKey) {
      this.logger.warn('WX_PAY_PUBLIC_KEY 未配置，跳过验签');
      return true; // 开发环境允许
    }

    const message = `${timestamp}\n${nonce}\n${body}\n`;
    const publicKey = createPublicKey(this.wxPublicKey);
    return verify('SHA256', Buffer.from(message), publicKey, Buffer.from(signature, 'base64'));
  }

  /**
   * 解密回调资源（AES-256-GCM）
   * @param resource { ciphertext, nonce, associated_data }
   */
  decryptResource(resource: {
    ciphertext: string;
    nonce: string;
    associated_data: string;
  }): DecryptedResource {
    if (!this.apiV3Key) {
      this.logger.warn('WX_API_V3_KEY 未配置，返回 mock 数据');
      return {
        out_trade_no: 'mock_order',
        trade_state: 'SUCCESS',
        amount: { total: 100, currency: 'CNY' },
        payer: { openid: 'mock_openid' },
      };
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.apiV3Key, 'utf-8'),
      Buffer.from(resource.nonce, 'utf-8'),
    );

    decipher.setAAD(Buffer.from(resource.associated_data, 'utf-8'));

    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    // GCM 模式最后 16 字节是 tag
    const tag = ciphertext.subarray(-16);
    const encrypted = ciphertext.subarray(0, -16);

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString('utf-8'));
  }

  /**
   * 前端二次签名（用于调起 wx.requestPayment）
   * @param prepayId 预支付ID
   */
  signForFrontend(prepayId: string): {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'RSA';
    paySign: string;
  } {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonce();
    const packageValue = `prepay_id=${prepayId}`;
    const message = `${this.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;

    let paySign: string;
    if (!this.privateKey) {
      paySign = 'MOCK_FRONTEND_SIGN';
    } else {
      const signer = createSign('SHA256');
      signer.update(message);
      signer.end();
      paySign = signer.sign(this.privateKey, 'base64');
    }

    return {
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: 'RSA',
      paySign,
    };
  }

  /**
   * SHA256 哈希
   */
  sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
