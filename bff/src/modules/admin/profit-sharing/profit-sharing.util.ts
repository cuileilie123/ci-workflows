/**
 * 分佣计算通用工具函数
 *
 * 提供与框架无关的纯函数，封装分段抽佣（类似个人所得税累进）和单一比例抽佣的计算逻辑。
 * 可在 Service、脚本、前端等任意场景直接调用。
 *
 * 核心公式：
 *   接单者收入 = 订单总额 - 平台抽佣 - 微信支付渠道费
 *   接单者比例 = 1 - 平台抽佣比例 - 微信支付渠道费率
 */

// ============================================================
// 常量
// ============================================================

/**
 * 微信支付渠道费率（支付给微信支付平台的手续费）。
 * 写入底层代码，中端工作人员及用户端仅保留阅读权限，不可修改。
 * 实际值：0.6%
 */
export const WECHAT_CHANNEL_RATE = 0.006;

/** 默认平台抽佣比例（未匹配到规则时使用） */
export const DEFAULT_PLATFORM_RATE = 0.1;

/** 金额精度：保留 2 位小数（分） */
const ROUND_FACTOR = 100;

function round2(n: number): number {
  return Math.round(n * ROUND_FACTOR) / ROUND_FACTOR;
}

/** 接单者比例精度：保留 4 位小数 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 校验金额参数：必须是非负有限数。
 * @throws Error 当金额为负数、NaN 或 Infinity 时
 */
function validateAmount(amount: number, name = 'totalAmount'): void {
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    throw new Error(`${name} 必须是有效数字`);
  }
  if (!Number.isFinite(amount)) {
    throw new Error(`${name} 必须是有限数`);
  }
  if (amount < 0) {
    throw new Error(`${name} 不能为负数`);
  }
}

/**
 * 校验比例参数：必须在 0-1 之间。
 * @throws Error 当比例超出范围或非有效数字时
 */
function validateRate(rate: number, name = 'platformRate'): void {
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    throw new Error(`${name} 必须是有效数字`);
  }
  if (rate < 0 || rate > 1) {
    throw new Error(`${name} 必须在 0-1 之间`);
  }
}

// ============================================================
// 类型定义
// ============================================================

/** 抽佣模式 */
export type CommissionMode = 'FLAT' | 'TIERED';

/** 分段抽佣区间 */
export interface Tier {
  /** 区间起始金额（含），第一段必须为 0 */
  rangeStart: number;
  /** 区间结束金额（不含），最后一段为 null/undefined 表示无上限 */
  rangeEnd?: number | null;
  /** 该区间平台抽佣比例 0-1（0.1 = 10%） */
  platformRate: number;
}

/** FLAT 模式规则参数 */
export interface FlatRuleParams {
  mode: 'FLAT';
  /** 平台抽佣比例 0-1 */
  platformRate: number;
  /** 最低平台抽成（元），可选 */
  minPlatformFee?: number | null;
  /** 最高平台抽成（元），可选 */
  maxPlatformFee?: number | null;
}

/** TIERED 模式规则参数 */
export interface TieredRuleParams {
  mode: 'TIERED';
  /** 分段抽佣区间配置 */
  tiers: Tier[];
}

/** 通用规则参数（FLAT 或 TIERED） */
export type RuleParams = FlatRuleParams | TieredRuleParams;

/** 分佣计算结果 */
export interface CommissionResult {
  /** 订单总额 */
  totalAmount: number;
  /** 平台抽佣金额 */
  platformFee: number;
  /** 微信支付渠道费 */
  wechatFee: number;
  /** 接单者收入 */
  helperAmount: number;
  /** 抽佣模式 */
  mode: CommissionMode;
  /** 平台抽佣比例（TIERED 模式为第一段比例，用于展示） */
  platformRate: number;
  /** 接单者比例 = 1 - platformRate - WECHAT_CHANNEL_RATE */
  helperRate: number;
  /** 分段计算明细（仅 TIERED 模式有值） */
  tierBreakdown?: TierBreakdownItem[];
}

/** 分段计算明细项 */
export interface TierBreakdownItem {
  /** 段号（从 1 开始） */
  tierIndex: number;
  /** 区间起始 */
  rangeStart: number;
  /** 区间结束（null = 无上限） */
  rangeEnd: number | null | undefined;
  /** 本段内实际金额 */
  amountInTier: number;
  /** 本段抽佣比例 */
  platformRate: number;
  /** 本段抽佣金额 */
  fee: number;
}

// ============================================================
// 核心计算函数
// ============================================================

/**
 * 计算接单者比例 = 1 - 平台抽佣比例 - 微信支付渠道费率
 *
 * @param platformRate 平台抽佣比例（0-1）
 * @returns 接单者比例（保留 4 位小数）
 *
 * @example
 * calcHelperRate(0.1) // 0.894 (1 - 0.1 - 0.006)
 * calcHelperRate(0.05) // 0.944
 */
export function calcHelperRate(platformRate: number): number {
  validateRate(platformRate);
  return round4(1 - platformRate - WECHAT_CHANNEL_RATE);
}

/**
 * 计算微信支付渠道费
 *
 * @param totalAmount 订单总额
 * @returns 微信渠道费（保留 2 位小数）
 *
 * @example
 * calcWechatFee(800) // 4.8 (800 * 0.006)
 */
export function calcWechatFee(totalAmount: number): number {
  validateAmount(totalAmount);
  return round2(totalAmount * WECHAT_CHANNEL_RATE);
}

/**
 * 分段累进计算平台抽佣（类似个人所得税）。
 *
 * 算法：将订单总额按区间从低到高逐段分配，每段金额乘以该段抽佣比例，累加得到总抽佣。
 *
 * @param total 订单总额
 * @param tiers 分段抽佣区间配置
 * @returns 平台抽佣金额 + 分段明细
 *
 * @example
 * const tiers = [
 *   { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
 *   { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
 *   { rangeStart: 500, rangeEnd: null, platformRate: 0.10 },
 * ];
 * calculateTieredFee(800, tiers);
 * // → { fee: 67, breakdown: [
 * //     { tierIndex: 1, rangeStart: 0, rangeEnd: 100, amountInTier: 100, platformRate: 0.05, fee: 5 },
 * //     { tierIndex: 2, rangeStart: 100, rangeEnd: 500, amountInTier: 400, platformRate: 0.08, fee: 32 },
 * //     { tierIndex: 3, rangeStart: 500, rangeEnd: null, amountInTier: 300, platformRate: 0.10, fee: 30 },
 * //   ]}
 */
export function calculateTieredFee(
  total: number,
  tiers: Tier[],
): { fee: number; breakdown: TierBreakdownItem[] } {
  validateAmount(total);
  if (!tiers || tiers.length === 0) {
    return { fee: 0, breakdown: [] };
  }

  const sorted = [...tiers].sort((a, b) => a.rangeStart - b.rangeStart);

  let fee = 0;
  let remaining = total;
  const breakdown: TierBreakdownItem[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i];
    if (remaining <= 0) break;

    const tierStart = tier.rangeStart;
    const tierEnd =
      tier.rangeEnd !== null && tier.rangeEnd !== undefined ? tier.rangeEnd : Infinity;
    const tierWidth = tierEnd - tierStart;

    const amountInTier = Math.min(remaining, tierWidth);
    if (amountInTier <= 0) continue;

    const tierFee = amountInTier * tier.platformRate;
    fee += tierFee;
    remaining -= amountInTier;

    breakdown.push({
      tierIndex: i + 1,
      rangeStart: tier.rangeStart,
      rangeEnd: tier.rangeEnd,
      amountInTier: round2(amountInTier),
      platformRate: tier.platformRate,
      fee: round2(tierFee),
    });
  }

  return { fee, breakdown };
}

/**
 * FLAT 模式计算平台抽佣（受 min/max 约束）
 *
 * @param total 订单总额
 * @param platformRate 平台抽佣比例
 * @param minPlatformFee 最低平台抽成（可选）
 * @param maxPlatformFee 最高平台抽成（可选）
 * @returns 平台抽佣金额
 *
 * @example
 * calculateFlatFee(100, 0.1) // 10
 * calculateFlatFee(30, 0.05, 5) // 5 (30*5%=1.5，但最低 5)
 * calculateFlatFee(500, 0.15, null, 20) // 20 (500*15%=75，但最高 20)
 */
export function calculateFlatFee(
  total: number,
  platformRate: number,
  minPlatformFee?: number | null,
  maxPlatformFee?: number | null,
): number {
  validateAmount(total);
  validateRate(platformRate);
  let fee = total * platformRate;
  if (minPlatformFee !== null && minPlatformFee !== undefined) {
    fee = Math.max(fee, minPlatformFee);
  }
  if (maxPlatformFee !== null && maxPlatformFee !== undefined) {
    fee = Math.min(fee, maxPlatformFee);
  }
  return fee;
}

// ============================================================
// 校验函数
// ============================================================

/**
 * 校验分段抽佣区间配置的合法性和连续性。
 *
 * 规则：
 * 1. 至少需要 1 个区间
 * 2. 第一段起始金额必须为 0
 * 3. 每段抽佣比例必须在 0-1 之间
 * 4. 每段结束金额必须大于起始金额
 * 5. 区间必须连续（前一段结束 = 后一段起始）
 * 6. 只有最后一段可以无上限（rangeEnd = null）
 *
 * @param tiers 分段抽佣区间配置
 * @throws Error 当配置不合法时抛出错误
 */
export function validateTiers(tiers: Tier[]): void {
  if (!tiers || tiers.length === 0) {
    throw new Error('分段抽佣至少需要 1 个区间');
  }

  const sorted = [...tiers].sort((a, b) => a.rangeStart - b.rangeStart);

  if (sorted[0].rangeStart !== 0) {
    throw new Error('第一段区间起始金额必须为 0');
  }

  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i];

    if (tier.platformRate < 0 || tier.platformRate > 1) {
      throw new Error(`第 ${i + 1} 段平台抽佣比例必须在 0-1 之间`);
    }

    if (tier.rangeEnd !== null && tier.rangeEnd !== undefined) {
      if (tier.rangeEnd <= tier.rangeStart) {
        throw new Error(`第 ${i + 1} 段区间结束金额必须大于起始金额`);
      }
    }

    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (tier.rangeEnd === null || tier.rangeEnd === undefined) {
        throw new Error(`第 ${i + 1} 段不能是无上限区间（只有最后一段可以）`);
      }
      if (Math.abs(tier.rangeEnd - next.rangeStart) > 0.01) {
        throw new Error(
          `第 ${i + 1} 段结束金额(${tier.rangeEnd})必须等于第 ${i + 2} 段起始金额(${next.rangeStart})`,
        );
      }
    }
  }
}

/**
 * 校验 FLAT 模式的 min/max 费用范围
 *
 * @throws Error 当 max < min 时
 */
export function validateFlatFeeRange(
  minPlatformFee?: number | null,
  maxPlatformFee?: number | null,
): void {
  if (
    minPlatformFee !== undefined &&
    minPlatformFee !== null &&
    maxPlatformFee !== undefined &&
    maxPlatformFee !== null &&
    maxPlatformFee < minPlatformFee
  ) {
    throw new Error('maxPlatformFee 不能小于 minPlatformFee');
  }
}

// ============================================================
// 高层封装：一站式分佣计算
// ============================================================

/**
 * 计算分佣（一站式封装，支持 FLAT 和 TIERED 两种模式）。
 *
 * 根据规则参数计算平台抽佣、微信渠道费和接单者收入，返回完整明细。
 *
 * @param totalAmount 订单总额
 * @param rule 规则参数（FLAT 或 TIERED）
 * @returns 分佣计算结果（含分段明细）
 *
 * @example FLAT 模式
 * calculateCommission(100, { mode: 'FLAT', platformRate: 0.1 })
 * // → { totalAmount: 100, platformFee: 10, wechatFee: 0.6, helperAmount: 89.4, ... }
 *
 * @example TIERED 模式（800 元，3 段累进）
 * calculateCommission(800, {
 *   mode: 'TIERED',
 *   tiers: [
 *     { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
 *     { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
 *     { rangeStart: 500, rangeEnd: null, platformRate: 0.10 },
 *   ],
 * })
 * // → { totalAmount: 800, platformFee: 67, wechatFee: 4.8, helperAmount: 728.2, ... }
 */
export function calculateCommission(totalAmount: number, rule: RuleParams): CommissionResult {
  validateAmount(totalAmount);
  const total = totalAmount;
  const wechatFee = calcWechatFee(total);

  let platformFee: number;
  let displayPlatformRate: number;
  let tierBreakdown: TierBreakdownItem[] | undefined;

  if (rule.mode === 'TIERED') {
    validateTiers(rule.tiers);
    const sorted = [...rule.tiers].sort((a, b) => a.rangeStart - b.rangeStart);
    displayPlatformRate = sorted[0].platformRate;

    const result = calculateTieredFee(total, rule.tiers);
    platformFee = result.fee;
    tierBreakdown = result.breakdown;
  } else {
    displayPlatformRate = rule.platformRate;
    validateFlatFeeRange(rule.minPlatformFee, rule.maxPlatformFee);
    platformFee = calculateFlatFee(
      total,
      rule.platformRate,
      rule.minPlatformFee,
      rule.maxPlatformFee,
    );
  }

  platformFee = round2(platformFee);

  // 接单者收入 = 总额 - 平台抽佣 - 微信渠道费
  let helperAmount = round2(total - platformFee - wechatFee);

  // 边界保护：接单者收入不能为负
  if (helperAmount < 0) {
    helperAmount = 0;
    platformFee = round2(total - wechatFee);
  }

  return {
    totalAmount: total,
    platformFee,
    wechatFee,
    helperAmount,
    mode: rule.mode,
    platformRate: displayPlatformRate,
    helperRate: calcHelperRate(displayPlatformRate),
    tierBreakdown,
  };
}
