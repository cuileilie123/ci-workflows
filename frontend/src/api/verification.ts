import { request } from '@/utils/request';
import type { VerificationStatus, BankCardInfo, RealNameInfo } from '@/types';

export const verificationApi = {
  /** 获取认证状态（手机号/银行卡/实名） */
  getStatus(): Promise<VerificationStatus> {
    return request<VerificationStatus>({
      url: '/verification/status',
      _silent: true,
    });
  },

  /** 绑定手机号（微信 getPhoneNumber code 或直接传入手机号） */
  bindPhone(code?: string, phone?: string): Promise<{ phone: string }> {
    const data: Record<string, unknown> = {};
    if (code) data.code = code;
    if (phone) data.phone = phone;
    return request<{ phone: string }>({
      url: '/verification/phone',
      method: 'POST',
      data,
    });
  },

  /** 银行卡列表 */
  listBankCards(): Promise<BankCardInfo[]> {
    return request<BankCardInfo[]>({
      url: '/verification/bank-cards',
      _silent: true,
    });
  },

  /** 绑定银行卡 */
  addBankCard(data: {
    holderName: string;
    bankName: string;
    cardNumber: string;
    isDefault?: boolean;
  }): Promise<BankCardInfo> {
    return request<BankCardInfo>({
      url: '/verification/bank-card',
      method: 'POST',
      data: data as unknown as Record<string, unknown>,
    });
  },

  /** 删除银行卡 */
  deleteBankCard(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>({
      url: `/verification/bank-card/${id}`,
      method: 'DELETE',
    });
  },

  /** 获取实名认证信息 */
  getRealName(): Promise<RealNameInfo | null> {
    return request<RealNameInfo | null>({
      url: '/verification/real-name',
      _silent: true,
    });
  },

  /** 提交实名认证 */
  submitRealName(realName: string, idCardNumber: string): Promise<RealNameInfo> {
    return request<RealNameInfo>({
      url: '/verification/real-name',
      method: 'POST',
      data: { realName, idCardNumber },
    });
  },
};
