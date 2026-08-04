import { paymentApi } from '@/api/payment';
import type { PayParams } from '@/api/payment';

/**
 * 完整支付流程：创建订单 → 获取支付参数 → 拉起微信支付 → 返回订单ID
 * @param taskId 任务ID
 * @returns 订单ID（支付成功）或 null（用户取消），或抛出异常（支付失败）
 */
export async function payForTask(taskId: string): Promise<string | null> {
  // 1. 创建订单
  const { orderId, payParams } = await paymentApi.createOrder(taskId);

  // 2. 拉起微信支付
  try {
    const result = await requestWxPayment(payParams);
    if (result === 'success') {
      return orderId;
    }
    // 用户取消
    return null;
  } catch (err) {
    throw new Error((err as Error).message || '支付失败');
  }
}

/**
 * 调用 wx.requestPayment（封装为 Promise）
 */
function requestWxPayment(params: PayParams): Promise<'success' | 'cancel'> {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wxRef = (globalThis as any).wx;
    if (wxRef && wxRef.requestPayment) {
      wxRef.requestPayment({
        timeStamp: params.timeStamp,
        nonceStr: params.nonceStr,
        package: params.package,
        signType: params.signType,
        paySign: params.paySign,
        success: () => resolve('success'),
        fail: (err: { errMsg?: string }) => {
          if (err.errMsg && err.errMsg.includes('cancel')) {
            resolve('cancel');
          } else {
            reject(new Error(err.errMsg || '支付失败'));
          }
        },
      });
    } else {
      console.warn('[wx.requestPayment] wx 不可用，模拟支付成功');
      resolve('success');
    }
    // #endif

    // 非微信小程序环境（开发调试）
    // #ifndef MP-WEIXIN
    console.warn('[wx.requestPayment] 仅在微信小程序环境可用，模拟支付成功');
    resolve('success');
    // #endif
  });
}

/**
 * 轮询订单状态（兜底方案）
 * @param orderId 订单ID
 * @param maxAttempts 最大轮询次数
 * @param interval 间隔时间（毫秒）
 */
export async function pollOrderStatus(
  orderId: string,
  maxAttempts = 10,
  interval = 3000,
): Promise<'PAID' | 'CANCELLED' | 'TIMEOUT'> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const result = await paymentApi.queryOrder(orderId);
      if (result.status === 'PAID' || result.status === 'IN_PROGRESS') {
        return 'PAID';
      }
      if (result.status === 'CANCELLED') {
        return 'CANCELLED';
      }
    } catch {
      // 查询失败继续轮询
    }
  }
  return 'TIMEOUT';
}
