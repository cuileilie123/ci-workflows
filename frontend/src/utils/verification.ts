import { verificationApi } from '@/api/verification';
import type { VerificationStatus } from '@/types';

/**
 * 检查用户是否已完成全部认证（手机号 + 银行卡 + 实名）。
 * 未完成时弹窗提示并引导跳转到认证中心，返回 false。
 * 已完成返回 true。
 *
 * @param action 本次操作的描述，如 "发布任务"、"接单"、"提现"
 */
export async function requireVerification(action: string): Promise<boolean> {
  let status: VerificationStatus;
  try {
    status = await verificationApi.getStatus();
  } catch {
    uni.showToast({ title: '无法获取认证状态，请稍后重试', icon: 'none' });
    return false;
  }

  if (status.canUseCoreFeatures) return true;

  const missing: string[] = [];
  if (!status.phoneBound) missing.push('手机号绑定');
  if (!status.bankCardBound) missing.push('银行卡绑定');
  if (!status.realNameVerified) missing.push('实名认证');

  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '需要完成认证',
      content: `${action}前需完成：${missing.join('、')}。是否前往认证中心？`,
      confirmText: '去认证',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          uni.navigateTo({ url: '/pages/user/verification' });
        }
        resolve(false);
      },
      fail: () => resolve(false),
    });
  });
}
