/**
 * 细粒度权限常量
 * 由老板账号（BOSS）授权给工作人员（STAFF），控制中端工作人员可操作的功能范围。
 * - BOSS / SUPER_ADMIN / ADMIN 自动拥有全部权限
 * - STAFF 需在 staff_permissions 表中显式授权后方可访问对应端点
 */
export const PERMISSIONS = {
  /** 分佣比例管理：创建/修改/删除分账规则 */
  PROFIT_SHARING_MANAGE: 'PROFIT_SHARING_MANAGE',
  /** 订单改价：修改未完成订单价格并打回发布者确认 */
  ORDER_PRICE_MANAGE: 'ORDER_PRICE_MANAGE',
  /** 任务分类管理：修改/删减任务分类标签 */
  TASK_CATEGORY_MANAGE: 'TASK_CATEGORY_MANAGE',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROFIT_SHARING_MANAGE,
  PERMISSIONS.ORDER_PRICE_MANAGE,
  PERMISSIONS.TASK_CATEGORY_MANAGE,
];

export const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSIONS.PROFIT_SHARING_MANAGE]: '分佣比例管理',
  [PERMISSIONS.ORDER_PRICE_MANAGE]: '订单改价',
  [PERMISSIONS.TASK_CATEGORY_MANAGE]: '任务分类管理',
};

/** 拥有全部权限的角色（无需显式授权） */
export const FULL_ACCESS_ROLES = ['BOSS', 'SUPER_ADMIN', 'ADMIN'];
