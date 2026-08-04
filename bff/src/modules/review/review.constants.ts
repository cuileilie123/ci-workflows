/**
 * 评价标签常量
 */
export const REVIEW_TAGS = {
  POSITIVE: ['准时到达', '态度友善', '专业靠谱', '超出预期', '沟通顺畅'],
  NEGATIVE: ['迟到爽约', '态度恶劣', '质量差', '沟通困难', '虚假描述'],
} as const;

export type ReviewTag = (typeof REVIEW_TAGS)[keyof typeof REVIEW_TAGS][number];

/**
 * 信用分等级
 */
export const CREDIT_LEVELS: Record<
  string,
  { min: number; label: string; icon: string; privileges: string[] }
> = {
  EXCELLENT: {
    min: 150,
    label: '优秀',
    icon: '⭐⭐⭐',
    privileges: ['优先推荐', '免押金', '专属客服'],
  },
  GOOD: { min: 100, label: '良好', icon: '⭐⭐', privileges: ['正常接单'] },
  NORMAL: { min: 60, label: '一般', icon: '⭐', privileges: ['正常接单', '限制大额订单'] },
  LIMITED: { min: 0, label: '受限', icon: '⚠️', privileges: ['禁止接单', '仅可发单'] },
};

export function getCreditLevel(score: number): {
  label: string;
  icon: string;
  privileges: string[];
} {
  if (score >= CREDIT_LEVELS.EXCELLENT.min) return CREDIT_LEVELS.EXCELLENT;
  if (score >= CREDIT_LEVELS.GOOD.min) return CREDIT_LEVELS.GOOD;
  if (score >= CREDIT_LEVELS.NORMAL.min) return CREDIT_LEVELS.NORMAL;
  return CREDIT_LEVELS.LIMITED;
}

/** 低信用分阈值 */
export const CREDIT_THRESHOLD = {
  LOW_CREDIT: 60, // 低于此分限制接单
  FREEZE_ACCOUNT: 30, // 低于此分冻结账号
} as const;
