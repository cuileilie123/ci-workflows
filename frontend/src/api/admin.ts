import { request } from '@/utils/request';
import type {
  ActiveProfitSharingRule,
  AvailablePermission,
  MyPermissions,
  PendingPriceChange,
  PlatformFinanceSetting,
  PriceModifiableTask,
  ProfitSharingRule,
  ReceiverType,
  StaffPermissionCode,
  StaffWithPermissions,
  TaskCategoryItem,
  WechatFeeRate,
} from '@/types';

// ============ 权限 ============
export const permissionApi = {
  /** 当前登录用户的有效权限 */
  getMine(): Promise<MyPermissions> {
    return request<MyPermissions>({ url: '/admin/permissions/me' });
  },
  /** 列出全部可分配权限 */
  getAvailable(): Promise<AvailablePermission[]> {
    return request<AvailablePermission[]>({ url: '/admin/permissions/available' });
  },
  /** 老板视角：列出所有工作人员及其权限 */
  listStaff(): Promise<StaffWithPermissions[]> {
    return request<StaffWithPermissions[]>({ url: '/admin/permissions' });
  },
  /** 老板授权 */
  grant(userId: string, permission: StaffPermissionCode): Promise<{ success: boolean }> {
    return request<{ success: boolean }>({
      url: '/admin/permissions/grant',
      method: 'POST',
      data: { userId, permission },
    });
  },
  /** 老板撤销 */
  revoke(userId: string, permission: StaffPermissionCode): Promise<{ success: boolean }> {
    return request<{ success: boolean }>({
      url: '/admin/permissions/revoke',
      method: 'POST',
      data: { userId, permission },
    });
  },
  /** 老板：将普通用户提升为工作人员 */
  setStaff(userId: string): Promise<{ success: boolean; role: string }> {
    return request<{ success: boolean; role: string }>({
      url: '/admin/permissions/set-staff',
      method: 'POST',
      data: { userId },
    });
  },
};

// ============ 分账规则（管理端） ============
export interface ProfitRulePayload {
  name: string;
  categoryId?: string;
  mode: 'FLAT' | 'TIERED';
  platformRate?: number;
  tiers?: { rangeStart: number; rangeEnd: number | null; platformRate: number }[];
  minPlatformFee?: number;
  maxPlatformFee?: number;
  isActive?: boolean;
  validFrom?: string;
  validTo?: string;
  priority?: number;
}

export const profitSharingAdminApi = {
  list(): Promise<ProfitSharingRule[]> {
    return request<ProfitSharingRule[]>({ url: '/admin/profit-sharing-rules' });
  },
  detail(id: string): Promise<ProfitSharingRule> {
    return request<ProfitSharingRule>({ url: `/admin/profit-sharing-rules/${id}` });
  },
  create(payload: ProfitRulePayload): Promise<ProfitSharingRule> {
    return request<ProfitSharingRule>({
      url: '/admin/profit-sharing-rules',
      method: 'POST',
      data: payload as unknown as Record<string, unknown>,
    });
  },
  update(id: string, payload: Partial<ProfitRulePayload>): Promise<ProfitSharingRule> {
    return request<ProfitSharingRule>({
      url: `/admin/profit-sharing-rules/${id}`,
      method: 'PUT',
      data: payload as unknown as Record<string, unknown>,
    });
  },
  remove(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>({
      url: `/admin/profit-sharing-rules/${id}`,
      method: 'DELETE',
    });
  },
};

// ============ 分账规则（用户端只读） ============
export const profitSharingUserApi = {
  /** 查看当前生效的分账规则（只读） */
  listActive(): Promise<ActiveProfitSharingRule[]> {
    return request<ActiveProfitSharingRule[]>({ url: '/profit-sharing/rules' });
  },
  /** 查看微信支付渠道费率（只读，0.6%） */
  wechatFeeRate(): Promise<WechatFeeRate> {
    return request<WechatFeeRate>({ url: '/profit-sharing/wechat-fee-rate' });
  },
};

// ============ 任务类别（管理端） ============
export interface TaskCategoryPayload {
  code?: string;
  name?: string;
  icon?: string;
  sort?: number;
  isActive?: boolean;
}

export const taskCategoryAdminApi = {
  list(includeInactive = false): Promise<TaskCategoryItem[]> {
    return request<TaskCategoryItem[]>({
      url: `/admin/task-categories${includeInactive ? '?includeInactive=true' : ''}`,
    });
  },
  create(payload: { code: string; name: string; icon?: string; sort?: number; isActive?: boolean }): Promise<TaskCategoryItem> {
    return request<TaskCategoryItem>({
      url: '/admin/task-categories',
      method: 'POST',
      data: payload as unknown as Record<string, unknown>,
    });
  },
  update(id: string, payload: TaskCategoryPayload): Promise<TaskCategoryItem> {
    return request<TaskCategoryItem>({
      url: `/admin/task-categories/${id}`,
      method: 'PATCH',
      data: payload as unknown as Record<string, unknown>,
    });
  },
  remove(id: string): Promise<void> {
    return request<void>({ url: `/admin/task-categories/${id}`, method: 'DELETE' });
  },
};

/** 用户端只读：启用的任务类别 */
export const taskCategoryUserApi = {
  list(): Promise<TaskCategoryItem[]> {
    return request<TaskCategoryItem[]>({ url: '/task-categories' });
  },
};

// ============ 订单改价 ============
export const orderPriceApi = {
  /** 查询可改价的已发布未完成任务 */
  listIncompleteTasks(page = 1, pageSize = 20): Promise<{
    list: PriceModifiableTask[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    return request({
      url: `/admin/order-price/tasks?page=${page}&pageSize=${pageSize}`,
    });
  },
  /** 工作人员发起改价 */
  createPriceModification(
    taskId: string,
    payload: { newPrice: number; reason?: string },
  ): Promise<{
    id: string;
    taskId: string;
    oldPrice: number;
    newPrice: number;
    reason: string | null;
    previousStatus: string;
    status: string;
    createdAt: string;
  }> {
    return request({
      url: `/admin/order-price/tasks/${taskId}/price-modification`,
      method: 'POST',
      data: payload as unknown as Record<string, unknown>,
    });
  },
};

/** 发布者端：确认/拒绝改价 */
export const priceChangeApi = {
  /** 查询我待确认的改价单 */
  listPending(): Promise<PendingPriceChange[]> {
    return request<PendingPriceChange[]>({ url: '/tasks/price-changes/pending' });
  },
  /** 确认改价 */
  confirm(taskId: string): Promise<{
    success: boolean;
    taskId: string;
    oldPrice: number;
    newPrice: number;
    difference: number;
    settlement: string;
  }> {
    return request({
      url: `/tasks/${taskId}/confirm-price-change`,
      method: 'POST',
    });
  },
  /** 拒绝改价 */
  reject(taskId: string): Promise<{ success: boolean; restoredStatus: string }> {
    return request({
      url: `/tasks/${taskId}/reject-price-change`,
      method: 'POST',
    });
  },
};

// ============ 老板端：财务设置（平台佣金收款账号） ============
export interface FinanceSettingPayload {
  profitSharingEnabled: boolean;
  receiverType: ReceiverType;
  receiverMchId?: string | null;
  receiverName?: string | null;
  receiverOpenid?: string | null;
  mainMchId?: string | null;
  mainAppId?: string | null;
}

export const financeSettingsApi = {
  /** 查询当前设置（单例；尚未保存时返回 null） */
  get(): Promise<PlatformFinanceSetting | null> {
    return request<PlatformFinanceSetting | null>({ url: '/admin/finance-settings' });
  },
  /** 保存（upsert 单例） */
  save(payload: FinanceSettingPayload): Promise<PlatformFinanceSetting> {
    return request<PlatformFinanceSetting>({
      url: '/admin/finance-settings',
      method: 'PUT',
      data: payload as unknown as Record<string, unknown>,
    });
  },
};
