import { request } from '@/utils/request';
import type { RefundRequestInfo } from '@/types';

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
  taskId: string;
  status: 'PENDING' | 'PAID' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED' | 'REFUND_PENDING';
  totalAmount: string;
  paidAt: string | null;
  createdAt?: string;
  refundAmount?: string | null;
  taskTitle?: string;
  taskAddress?: string;
  publisherId?: string;
  helperId?: string;
}

/** 申请退款返回 */
export interface RequestRefundResult {
  success: boolean;
  refundRequestId: string;
  message: string;
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

  /** 获取用户订单列表 */
  getUserOrders(params?: { status?: string; page?: number; pageSize?: number }): Promise<OrderQueryResult[]> {
    const query: string[] = [];
    if (params?.status) query.push(`status=${params.status}`);
    if (params?.page) query.push(`page=${params.page}`);
    if (params?.pageSize) query.push(`pageSize=${params.pageSize}`);
    const queryString = query.length > 0 ? `?${query.join('&')}` : '';
    return request<OrderQueryResult[]>({
      url: `/pay/user-orders${queryString}`,
    });
  },

  /** 申请退款（24h 内原路退回到微信钱包/银行卡） */
  requestRefund(orderId: string, reason?: string): Promise<RequestRefundResult> {
    const data: Record<string, unknown> = {};
    if (reason) data.reason = reason;
    return request<RequestRefundResult>({
      url: `/pay/request-refund/${orderId}`,
      method: 'POST',
      data,
    });
  },

  /** 查询退款状态 */
  getRefundStatus(orderId: string): Promise<RefundRequestInfo | null> {
    return request<RefundRequestInfo | null>({
      url: `/pay/refund-status/${orderId}`,
    });
  },

  /** 申请退款（旧接口，保留兼容） */
  refund(orderId: string, amount: number, reason?: string): Promise<{ success: boolean }> {
    const data: Record<string, unknown> = { orderId, amount };
    if (reason) data.reason = reason;
    return request<{ success: boolean }>({
      url: '/pay/refund',
      method: 'POST',
      data,
    });
  },

  /** 取消待支付订单 */
  cancelOrder(orderId: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>({
      url: `/pay/cancel/${orderId}`,
      method: 'POST',
    });
  },
};
