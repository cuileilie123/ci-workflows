import { request } from '@/utils/request';

/** 支付参数（用于 wx.requestPayment） */
export interface PayParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

/** 创建订单响应 */
export interface CreateOrderResult {
  orderId: string;
  payParams: PayParams;
}

/** 订单状态查询结果 */
export interface OrderQueryResult {
  id: string;
  status: 'PENDING' | 'PAID' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  totalAmount: string;
  paidAt: string | null;
  createdAt?: string;
  refundAmount?: string | null;
}

export const paymentApi = {
  /** 创建支付订单 */
  createOrder(taskId: string): Promise<CreateOrderResult> {
    return request<CreateOrderResult>({
      url: '/pay/create-order',
      method: 'POST',
      data: { taskId } as unknown as Record<string, unknown>,
    });
  },

  /** 查询订单状态 */
  queryOrder(orderId: string): Promise<OrderQueryResult> {
    return request<OrderQueryResult>({
      url: `/pay/query/${orderId}`,
    });
  },

  /** 申请退款 */
  refund(orderId: string, amount: number, reason?: string): Promise<{ success: boolean }> {
    const data: Record<string, unknown> = { orderId, amount };
    if (reason) data.reason = reason;
    return request<{ success: boolean }>({
      url: '/pay/refund',
      method: 'POST',
      data,
    });
  },
};
