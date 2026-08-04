import { request } from '@/utils/request';

/** 钱包余额 */
export interface WalletBalance {
  id: string;
  balance: number;
  frozen: number;
  available: number;
}

/** 交易流水 */
export interface Transaction {
  id: string;
  type: 'INCOME' | 'EXPENSE' | 'FREEZE' | 'UNFREEZE';
  amount: number;
  balanceAfter: number;
  description: string;
  orderId: string | null;
  createdAt: string;
}

/** 流水列表响应 */
export interface TransactionListResult {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 提现结果 */
export interface WithdrawResult {
  status: 'SUCCESS' | 'AUDIT_REQUIRED';
  message: string;
  transactionId?: string;
  amount?: number;
}

export const walletApi = {
  /** 查询钱包余额 */
  getBalance(): Promise<WalletBalance> {
    return request<WalletBalance>({
      url: '/wallet',
    });
  },

  /** 查询流水列表 */
  getTransactions(page = 1, pageSize = 20, type?: string): Promise<TransactionListResult> {
    const params: Record<string, string | number> = { page, pageSize };
    if (type) params.type = type;
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<TransactionListResult>({
      url: `/wallet/transactions?${query}`,
    });
  },

  /** 提现到微信零钱 */
  withdraw(amount: number): Promise<WithdrawResult> {
    return request<WithdrawResult>({
      url: '/wallet/withdraw',
      method: 'POST',
      data: { amount } as unknown as Record<string, unknown>,
    });
  },

  /** 内部转账 */
  transfer(toUserId: string, amount: number, description?: string): Promise<{ status: string; message: string }> {
    const data: Record<string, unknown> = { toUserId, amount };
    if (description) data.description = description;
    return request<{ status: string; message: string }>({
      url: '/wallet/transfer',
      method: 'POST',
      data,
    });
  },
};
