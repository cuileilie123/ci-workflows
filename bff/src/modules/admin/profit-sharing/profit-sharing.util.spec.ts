import {
  WECHAT_CHANNEL_RATE,
  DEFAULT_PLATFORM_RATE,
  Tier,
  calcHelperRate,
  calcWechatFee,
  calculateTieredFee,
  calculateFlatFee,
  validateTiers,
  validateFlatFeeRange,
  calculateCommission,
} from './profit-sharing.util';

// ============================================================
// 常量
// ============================================================
describe('常量', () => {
  it('WECHAT_CHANNEL_RATE 应为 0.006（0.6%）', () => {
    expect(WECHAT_CHANNEL_RATE).toBe(0.006);
  });

  it('DEFAULT_PLATFORM_RATE 应为 0.1（10%）', () => {
    expect(DEFAULT_PLATFORM_RATE).toBe(0.1);
  });
});

// ============================================================
// calcHelperRate
// ============================================================
describe('calcHelperRate - 接单者比例计算', () => {
  it('platformRate=0.1 时 helperRate=0.894 (1-0.1-0.006)', () => {
    expect(calcHelperRate(0.1)).toBe(0.894);
  });

  it('platformRate=0.05 时 helperRate=0.944 (1-0.05-0.006)', () => {
    expect(calcHelperRate(0.05)).toBe(0.944);
  });

  it('platformRate=0 时 helperRate=0.994 (1-0-0.006)', () => {
    expect(calcHelperRate(0)).toBe(0.994);
  });

  it('platformRate=0.994 时 helperRate=0 (1-0.994-0.006)', () => {
    expect(calcHelperRate(0.994)).toBe(0);
  });

  it('应保留 4 位小数精度', () => {
    // 1 - 0.1234 - 0.006 = 0.8706
    expect(calcHelperRate(0.1234)).toBe(0.8706);
  });
});

// ============================================================
// calcWechatFee
// ============================================================
describe('calcWechatFee - 微信渠道费计算', () => {
  it('800 元 → 4.8 元 (800*0.006)', () => {
    expect(calcWechatFee(800)).toBe(4.8);
  });

  it('100 元 → 0.6 元 (100*0.006)', () => {
    expect(calcWechatFee(100)).toBe(0.6);
  });

  it('0 元 → 0 元', () => {
    expect(calcWechatFee(0)).toBe(0);
  });

  it('应保留 2 位小数精度', () => {
    // 333 * 0.006 = 1.998 → 2.00
    expect(calcWechatFee(333)).toBe(2);
  });

  it('小数金额应正确四舍五入', () => {
    // 99.99 * 0.006 = 0.59994 → 0.6
    expect(calcWechatFee(99.99)).toBe(0.6);
  });
});

// ============================================================
// calculateTieredFee
// ============================================================
describe('calculateTieredFee - 分段累进计算', () => {
  const standardTiers: Tier[] = [
    { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
    { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
    { rangeStart: 500, rangeEnd: null, platformRate: 0.10 },
  ];

  it('800 元: 100*5% + 400*8% + 300*10% = 67', () => {
    const result = calculateTieredFee(800, standardTiers);
    expect(result.fee).toBe(67);
    expect(result.breakdown).toHaveLength(3);
  });

  it('800 元分段明细应正确', () => {
    const result = calculateTieredFee(800, standardTiers);
    expect(result.breakdown[0]).toEqual({
      tierIndex: 1, rangeStart: 0, rangeEnd: 100,
      amountInTier: 100, platformRate: 0.05, fee: 5,
    });
    expect(result.breakdown[1]).toEqual({
      tierIndex: 2, rangeStart: 100, rangeEnd: 500,
      amountInTier: 400, platformRate: 0.08, fee: 32,
    });
    expect(result.breakdown[2]).toEqual({
      tierIndex: 3, rangeStart: 500, rangeEnd: null,
      amountInTier: 300, platformRate: 0.10, fee: 30,
    });
  });

  it('50 元（仅第一段）: 50*5% = 2.5', () => {
    const result = calculateTieredFee(50, standardTiers);
    expect(result.fee).toBe(2.5);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].amountInTier).toBe(50);
  });

  it('100 元（恰好第一段边界）: 100*5% = 5', () => {
    const result = calculateTieredFee(100, standardTiers);
    expect(result.fee).toBe(5);
    expect(result.breakdown).toHaveLength(1);
  });

  it('500 元（恰好第二段边界）: 100*5% + 400*8% = 37', () => {
    const result = calculateTieredFee(500, standardTiers);
    expect(result.fee).toBe(37);
    expect(result.breakdown).toHaveLength(2);
  });

  it('0 元 → fee=0, breakdown 为空', () => {
    const result = calculateTieredFee(0, standardTiers);
    expect(result.fee).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it('空 tiers → fee=0', () => {
    const result = calculateTieredFee(800, []);
    expect(result.fee).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it('null tiers → fee=0', () => {
    const result = calculateTieredFee(800, null as unknown as Tier[]);
    expect(result.fee).toBe(0);
  });

  it('乱序 tiers 应自动排序后计算', () => {
    const unsortedTiers: Tier[] = [
      { rangeStart: 500, rangeEnd: null, platformRate: 0.10 },
      { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
      { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
    ];
    const result = calculateTieredFee(800, unsortedTiers);
    expect(result.fee).toBe(67);
    // breakdown 应按排序后的顺序
    expect(result.breakdown[0].tierIndex).toBe(1);
    expect(result.breakdown[0].rangeStart).toBe(0);
  });

  it('单段无上限: 1000*10% = 100', () => {
    const singleTier: Tier[] = [
      { rangeStart: 0, rangeEnd: null, platformRate: 0.10 },
    ];
    const result = calculateTieredFee(1000, singleTier);
    expect(result.fee).toBe(100);
    expect(result.breakdown).toHaveLength(1);
  });

  it('超大金额应正确计算', () => {
    const result = calculateTieredFee(100000, standardTiers);
    // 100*5% + 400*8% + 99500*10% = 5 + 32 + 9950 = 9987
    expect(result.fee).toBe(9987);
  });
});

// ============================================================
// calculateFlatFee
// ============================================================
describe('calculateFlatFee - 单一比例计算', () => {
  it('100 元 * 10% = 10', () => {
    expect(calculateFlatFee(100, 0.1)).toBe(10);
  });

  it('无 min/max 时直接返回比例计算值', () => {
    expect(calculateFlatFee(500, 0.15)).toBe(75);
  });

  it('计算值低于 min 时取 min 值: 30*5%=1.5 → min 5', () => {
    expect(calculateFlatFee(30, 0.05, 5)).toBe(5);
  });

  it('计算值高于 max 时取 max 值: 500*15%=75 → max 20', () => {
    expect(calculateFlatFee(500, 0.15, null, 20)).toBe(20);
  });

  it('计算值在 min 和 max 之间时取计算值', () => {
    // 200 * 10% = 20, min=5, max=50 → 20
    expect(calculateFlatFee(200, 0.1, 5, 50)).toBe(20);
  });

  it('min 和 max 同时约束: min > 计算值, max 不影响', () => {
    // 50 * 5% = 2.5, min=10, max=100 → 10
    expect(calculateFlatFee(50, 0.05, 10, 100)).toBe(10);
  });

  it('min 和 max 同时约束: max < 计算值, min 不影响', () => {
    // 1000 * 20% = 200, min=5, max=50 → 50
    expect(calculateFlatFee(1000, 0.2, 5, 50)).toBe(50);
  });

  it('min=0 时不影响计算', () => {
    expect(calculateFlatFee(100, 0.1, 0)).toBe(10);
  });

  it('0 元 → 0', () => {
    expect(calculateFlatFee(0, 0.1)).toBe(0);
  });

  it('platformRate=0 → 0', () => {
    expect(calculateFlatFee(100, 0)).toBe(0);
  });
});

// ============================================================
// validateTiers
// ============================================================
describe('validateTiers - 分段区间校验', () => {
  const validTiers: Tier[] = [
    { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
    { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
    { rangeStart: 500, rangeEnd: null, platformRate: 0.10 },
  ];

  it('合法的三段区间应通过校验', () => {
    expect(() => validateTiers(validTiers)).not.toThrow();
  });

  it('单段无上限区间应通过校验', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: null, platformRate: 0.05 },
    ])).not.toThrow();
  });

  it('空数组应抛出异常', () => {
    expect(() => validateTiers([])).toThrow('分段抽佣至少需要 1 个区间');
  });

  it('null 应抛出异常', () => {
    expect(() => validateTiers(null as unknown as Tier[])).toThrow('分段抽佣至少需要 1 个区间');
  });

  it('第一段起始不为 0 应抛出异常', () => {
    expect(() => validateTiers([
      { rangeStart: 10, rangeEnd: null, platformRate: 0.05 },
    ])).toThrow('第一段区间起始金额必须为 0');
  });

  it('区间不连续应抛出异常', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
      { rangeStart: 200, rangeEnd: null, platformRate: 0.1 },
    ])).toThrow('必须等于');
  });

  it('非最后段 rangeEnd=null 应抛出异常', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: null, platformRate: 0.05 },
      { rangeStart: 100, rangeEnd: null, platformRate: 0.1 },
    ])).toThrow('不能是无上限区间');
  });

  it('platformRate 超出 0-1 应抛出异常', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: null, platformRate: 1.5 },
    ])).toThrow('必须在 0-1 之间');
  });

  it('platformRate 为负数应抛出异常', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: null, platformRate: -0.1 },
    ])).toThrow('必须在 0-1 之间');
  });

  it('rangeEnd <= rangeStart 应抛出异常', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: 0, platformRate: 0.05 },
    ])).toThrow('结束金额必须大于起始金额');
  });

  it('乱序的合法区间应通过校验（内部自动排序）', () => {
    const unsorted: Tier[] = [
      { rangeStart: 500, rangeEnd: null, platformRate: 0.10 },
      { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
      { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
    ];
    expect(() => validateTiers(unsorted)).not.toThrow();
  });

  it('platformRate=0 应通过校验', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: null, platformRate: 0 },
    ])).not.toThrow();
  });

  it('platformRate=1 应通过校验', () => {
    expect(() => validateTiers([
      { rangeStart: 0, rangeEnd: null, platformRate: 1 },
    ])).not.toThrow();
  });
});

// ============================================================
// validateFlatFeeRange
// ============================================================
describe('validateFlatFeeRange - FLAT 费用范围校验', () => {
  it('min < max 应通过', () => {
    expect(() => validateFlatFeeRange(5, 50)).not.toThrow();
  });

  it('min = max 应通过', () => {
    expect(() => validateFlatFeeRange(10, 10)).not.toThrow();
  });

  it('max < min 应抛出异常', () => {
    expect(() => validateFlatFeeRange(50, 10)).toThrow('maxPlatformFee 不能小于 minPlatformFee');
  });

  it('仅提供 min 应通过', () => {
    expect(() => validateFlatFeeRange(5, null)).not.toThrow();
  });

  it('仅提供 max 应通过', () => {
    expect(() => validateFlatFeeRange(null, 50)).not.toThrow();
  });

  it('都不提供应通过', () => {
    expect(() => validateFlatFeeRange(undefined, undefined)).not.toThrow();
  });
});

// ============================================================
// calculateCommission - TIERED 模式
// ============================================================
describe('calculateCommission - TIERED 模式', () => {
  const tieredRule = {
    mode: 'TIERED' as const,
    tiers: [
      { rangeStart: 0, rangeEnd: 100, platformRate: 0.05 },
      { rangeStart: 100, rangeEnd: 500, platformRate: 0.08 },
      { rangeStart: 500, rangeEnd: null, platformRate: 0.10 },
    ],
  };

  it('800 元: platformFee=67, wechatFee=4.8, helperAmount=728.2', () => {
    const r = calculateCommission(800, tieredRule);
    expect(r.platformFee).toBe(67);
    expect(r.wechatFee).toBe(4.8);
    expect(r.helperAmount).toBe(728.2);
  });

  it('800 元: mode 和比例正确', () => {
    const r = calculateCommission(800, tieredRule);
    expect(r.mode).toBe('TIERED');
    expect(r.platformRate).toBe(0.05); // 第一段比例
    expect(r.helperRate).toBe(0.944);  // 1 - 0.05 - 0.006
  });

  it('800 元: totalAmount 回显正确', () => {
    const r = calculateCommission(800, tieredRule);
    expect(r.totalAmount).toBe(800);
  });

  it('800 元: tierBreakdown 包含 3 段明细', () => {
    const r = calculateCommission(800, tieredRule);
    expect(r.tierBreakdown).toHaveLength(3);
    expect(r.tierBreakdown![0].fee).toBe(5);
    expect(r.tierBreakdown![1].fee).toBe(32);
    expect(r.tierBreakdown![2].fee).toBe(30);
  });

  it('50 元（仅第一段）: platformFee=2.5, helperAmount=47.2', () => {
    const r = calculateCommission(50, tieredRule);
    expect(r.platformFee).toBe(2.5);
    expect(r.wechatFee).toBe(0.3);
    expect(r.helperAmount).toBe(47.2);
  });

  it('100 元（边界）: platformFee=5, helperAmount=94.4', () => {
    const r = calculateCommission(100, tieredRule);
    expect(r.platformFee).toBe(5);
    expect(r.wechatFee).toBe(0.6);
    expect(r.helperAmount).toBe(94.4);
  });

  it('0 元: 所有费用为 0', () => {
    const r = calculateCommission(0, tieredRule);
    expect(r.platformFee).toBe(0);
    expect(r.wechatFee).toBe(0);
    expect(r.helperAmount).toBe(0);
  });

  it('非法 tiers 应抛出异常', () => {
    const badRule = {
      mode: 'TIERED' as const,
      tiers: [{ rangeStart: 10, rangeEnd: null, platformRate: 0.05 }],
    };
    expect(() => calculateCommission(800, badRule)).toThrow();
  });

  it('单段无上限: 1000 元 → platformFee=100', () => {
    const singleTierRule = {
      mode: 'TIERED' as const,
      tiers: [{ rangeStart: 0, rangeEnd: null, platformRate: 0.10 }],
    };
    const r = calculateCommission(1000, singleTierRule);
    expect(r.platformFee).toBe(100);
    expect(r.wechatFee).toBe(6);
    expect(r.helperAmount).toBe(894);
  });
});

// ============================================================
// calculateCommission - FLAT 模式
// ============================================================
describe('calculateCommission - FLAT 模式', () => {
  it('100 元 * 10%: platformFee=10, wechatFee=0.6, helperAmount=89.4', () => {
    const r = calculateCommission(100, { mode: 'FLAT', platformRate: 0.1 });
    expect(r.platformFee).toBe(10);
    expect(r.wechatFee).toBe(0.6);
    expect(r.helperAmount).toBe(89.4);
  });

  it('helperRate = 1 - platformRate - 0.006 = 0.894', () => {
    const r = calculateCommission(100, { mode: 'FLAT', platformRate: 0.1 });
    expect(r.helperRate).toBe(0.894);
  });

  it('mode 和 totalAmount 正确', () => {
    const r = calculateCommission(100, { mode: 'FLAT', platformRate: 0.1 });
    expect(r.mode).toBe('FLAT');
    expect(r.totalAmount).toBe(100);
  });

  it('FLAT 模式不应返回 tierBreakdown', () => {
    const r = calculateCommission(100, { mode: 'FLAT', platformRate: 0.1 });
    expect(r.tierBreakdown).toBeUndefined();
  });

  it('带 min fee: 30*5%=1.5 → min 5', () => {
    const r = calculateCommission(30, { mode: 'FLAT', platformRate: 0.05, minPlatformFee: 5 });
    expect(r.platformFee).toBe(5);
    // helperAmount = 30 - 5 - 0.18 = 24.82
    expect(r.helperAmount).toBe(24.82);
  });

  it('带 max fee: 500*15%=75 → max 20', () => {
    const r = calculateCommission(500, { mode: 'FLAT', platformRate: 0.15, maxPlatformFee: 20 });
    expect(r.platformFee).toBe(20);
    // helperAmount = 500 - 20 - 3 = 477
    expect(r.helperAmount).toBe(477);
  });

  it('带 min+max: 200*10%=20, min=5, max=50 → 20', () => {
    const r = calculateCommission(200, {
      mode: 'FLAT', platformRate: 0.1, minPlatformFee: 5, maxPlatformFee: 50,
    });
    expect(r.platformFee).toBe(20);
  });

  it('0 元: 所有费用为 0', () => {
    const r = calculateCommission(0, { mode: 'FLAT', platformRate: 0.1 });
    expect(r.platformFee).toBe(0);
    expect(r.wechatFee).toBe(0);
    expect(r.helperAmount).toBe(0);
  });

  it('max < min 应抛出异常', () => {
    expect(() =>
      calculateCommission(100, {
        mode: 'FLAT', platformRate: 0.1, minPlatformFee: 50, maxPlatformFee: 10,
      }),
    ).toThrow('maxPlatformFee 不能小于 minPlatformFee');
  });
});

// ============================================================
// calculateCommission - 边界保护
// ============================================================
describe('calculateCommission - 边界保护', () => {
  it('接单者收入为负时应截断为 0', () => {
    // platformRate=0.994 → helperRate=0, platformFee=99.4
    // wechatFee=0.6, helperAmount = 100 - 99.4 - 0.6 = 0
    const r = calculateCommission(100, { mode: 'FLAT', platformRate: 0.994 });
    expect(r.helperAmount).toBe(0);
  });

  it('接单者收入为负时 platformFee 应调整为 total - wechatFee', () => {
    // platformRate=1 → 计算 fee=100, wechatFee=0.6
    // helperAmount = 100 - 100 - 0.6 = -0.6 → 截断为 0
    // platformFee 调整为 100 - 0.6 = 99.4
    const r = calculateCommission(100, { mode: 'FLAT', platformRate: 1 });
    expect(r.helperAmount).toBe(0);
    expect(r.platformFee).toBe(99.4);
  });

  it('TIERED 模式超高抽佣比例时也应有边界保护', () => {
    const highRateTiers: Tier[] = [
      { rangeStart: 0, rangeEnd: null, platformRate: 1 },
    ];
    const r = calculateCommission(100, { mode: 'TIERED', tiers: highRateTiers });
    expect(r.helperAmount).toBe(0);
    expect(r.platformFee).toBe(99.4);
  });

  it('极大金额应正确计算（TIERED）', () => {
    const tiers: Tier[] = [
      { rangeStart: 0, rangeEnd: 1000, platformRate: 0.05 },
      { rangeStart: 1000, rangeEnd: null, platformRate: 0.10 },
    ];
    const r = calculateCommission(100000, { mode: 'TIERED', tiers });
    // 1000*5% + 99000*10% = 50 + 9900 = 9950
    expect(r.platformFee).toBe(9950);
    // wechatFee = 100000 * 0.006 = 600
    expect(r.wechatFee).toBe(600);
    // helperAmount = 100000 - 9950 - 600 = 89450
    expect(r.helperAmount).toBe(89450);
  });

  it('小数金额应正确处理', () => {
    const r = calculateCommission(99.99, { mode: 'FLAT', platformRate: 0.1 });
    // platformFee = 99.99 * 0.1 = 9.999 → 10
    expect(r.platformFee).toBe(10);
    // wechatFee = 99.99 * 0.006 = 0.59994 → 0.6
    expect(r.wechatFee).toBe(0.6);
    // helperAmount = 99.99 - 10 - 0.6 = 89.39
    expect(r.helperAmount).toBe(89.39);
  });
});

// ============================================================
// 负数金额 - 应抛出异常
// ============================================================
describe('负数金额 - 应抛出异常', () => {
  it('calcHelperRate 负比例应抛出异常', () => {
    expect(() => calcHelperRate(-0.1)).toThrow('必须在 0-1 之间');
  });

  it('calcWechatFee 负金额应抛出异常', () => {
    expect(() => calcWechatFee(-100)).toThrow('不能为负数');
  });

  it('calculateTieredFee 负金额应抛出异常', () => {
    expect(() => calculateTieredFee(-100, [
      { rangeStart: 0, rangeEnd: null, platformRate: 0.05 },
    ])).toThrow('不能为负数');
  });

  it('calculateFlatFee 负金额应抛出异常', () => {
    expect(() => calculateFlatFee(-100, 0.1)).toThrow('不能为负数');
  });

  it('calculateFlatFee 负比例应抛出异常', () => {
    expect(() => calculateFlatFee(100, -0.1)).toThrow('必须在 0-1 之间');
  });

  it('calculateCommission TIERED 负金额应抛出异常', () => {
    expect(() => calculateCommission(-800, {
      mode: 'TIERED',
      tiers: [{ rangeStart: 0, rangeEnd: null, platformRate: 0.05 }],
    })).toThrow('不能为负数');
  });

  it('calculateCommission FLAT 负金额应抛出异常', () => {
    expect(() => calculateCommission(-100, { mode: 'FLAT', platformRate: 0.1 }))
      .toThrow('不能为负数');
  });
});

// ============================================================
// NaN - 应抛出异常
// ============================================================
describe('NaN - 应抛出异常', () => {
  it('calcHelperRate(NaN) 应抛出异常', () => {
    expect(() => calcHelperRate(NaN)).toThrow('必须是有效数字');
  });

  it('calcWechatFee(NaN) 应抛出异常', () => {
    expect(() => calcWechatFee(NaN)).toThrow('必须是有效数字');
  });

  it('calculateTieredFee NaN 金额应抛出异常', () => {
    expect(() => calculateTieredFee(NaN, [
      { rangeStart: 0, rangeEnd: null, platformRate: 0.05 },
    ])).toThrow('必须是有效数字');
  });

  it('calculateFlatFee NaN 金额应抛出异常', () => {
    expect(() => calculateFlatFee(NaN, 0.1)).toThrow('必须是有效数字');
  });

  it('calculateFlatFee NaN 比例应抛出异常', () => {
    expect(() => calculateFlatFee(100, NaN)).toThrow('必须是有效数字');
  });

  it('calculateCommission NaN 金额应抛出异常', () => {
    expect(() => calculateCommission(NaN, { mode: 'FLAT', platformRate: 0.1 }))
      .toThrow('必须是有效数字');
  });
});

// ============================================================
// Infinity - 应抛出异常
// ============================================================
describe('Infinity - 应抛出异常', () => {
  it('calcWechatFee(Infinity) 应抛出异常', () => {
    expect(() => calcWechatFee(Infinity)).toThrow('必须是有限数');
  });

  it('calculateTieredFee Infinity 金额应抛出异常', () => {
    expect(() => calculateTieredFee(Infinity, [
      { rangeStart: 0, rangeEnd: null, platformRate: 0.05 },
    ])).toThrow('必须是有限数');
  });

  it('calculateFlatFee Infinity 金额应抛出异常', () => {
    expect(() => calculateFlatFee(Infinity, 0.1)).toThrow('必须是有限数');
  });

  it('calculateCommission Infinity 金额应抛出异常', () => {
    expect(() => calculateCommission(Infinity, { mode: 'FLAT', platformRate: 0.1 }))
      .toThrow('必须是有限数');
  });
});

// ============================================================
// 极端大数 - 精度验证
// ============================================================
describe('极端大数 - 精度验证', () => {
  it('1万万元 FLAT 应正确计算', () => {
    const total = 100000000; // 1亿
    const r = calculateCommission(total, { mode: 'FLAT', platformRate: 0.1 });
    expect(r.platformFee).toBe(10000000);
    expect(r.wechatFee).toBe(600000);
    expect(r.helperAmount).toBe(89400000);
  });

  it('1万万元 TIERED 应正确计算', () => {
    const total = 100000000;
    const tiers: Tier[] = [
      { rangeStart: 0, rangeEnd: 10000, platformRate: 0.05 },
      { rangeStart: 10000, rangeEnd: null, platformRate: 0.10 },
    ];
    const r = calculateCommission(total, { mode: 'TIERED', tiers });
    // 10000*5% + 99990000*10% = 500 + 9999000 = 9999500
    expect(r.platformFee).toBe(9999500);
    expect(r.wechatFee).toBe(600000);
    expect(r.helperAmount).toBe(89400500);
  });

  it('安全整数上限附近应正确计算', () => {
    const total = Number.MAX_SAFE_INTEGER; // 9007199254740991
    const r = calculateCommission(total, { mode: 'FLAT', platformRate: 0 });
    // platformRate=0 → platformFee=0
    expect(r.platformFee).toBe(0);
    // wechatFee = MAX_SAFE_INTEGER * 0.006 — 精度可能丢失但不应崩溃
    expect(r.wechatFee).toBeGreaterThan(0);
    expect(r.helperAmount).toBeGreaterThan(0);
  });

  it('calcWechatFee 大数应不崩溃', () => {
    expect(() => calcWechatFee(99999999999.99)).not.toThrow();
    const fee = calcWechatFee(99999999999.99);
    expect(fee).toBeGreaterThan(0);
  });
});

// ============================================================
// FLAT 模式 min > total 边界
// ============================================================
describe('FLAT 模式 - min 超过总额的边界', () => {
  it('minPlatformFee > total 时 helperAmount 应被保护为 0', () => {
    // total=10, rate=10% → fee=1, min=50 → fee=50
    // helperAmount = 10 - 50 - 0.06 = -40.06 → 截断为 0
    const r = calculateCommission(10, {
      mode: 'FLAT', platformRate: 0.1, minPlatformFee: 50,
    });
    expect(r.helperAmount).toBe(0);
    // platformFee 调整为 total - wechatFee = 10 - 0.06 = 9.94
    expect(r.platformFee).toBe(9.94);
  });

  it('calculateFlatFee min > total 时返回 min 值', () => {
    // 底层函数不做保护，只返回计算值
    expect(calculateFlatFee(10, 0.1, 50)).toBe(50);
  });
});

// ============================================================
// 小数边界 - tier 使用小数金额
// ============================================================
describe('小数边界 - tier 使用小数金额', () => {
  it('小数区间边界应正确计算', () => {
    const tiers: Tier[] = [
      { rangeStart: 0, rangeEnd: 0.01, platformRate: 0.05 },
      { rangeStart: 0.01, rangeEnd: null, platformRate: 0.10 },
    ];
    // 0.01 * 5% + 99.99 * 10% = 0.0005 + 9.999 = 9.9995
    const result = calculateTieredFee(100, tiers);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].amountInTier).toBe(0.01);
    expect(result.breakdown[1].amountInTier).toBe(99.99);
  });

  it('极小金额（0.01 元）应正确处理', () => {
    const r = calculateCommission(0.01, { mode: 'FLAT', platformRate: 0.1 });
    // platformFee = 0.01 * 0.1 = 0.001 → round2 → 0
    expect(r.platformFee).toBe(0);
    // wechatFee = 0.01 * 0.006 = 0.00006 → round2 → 0
    expect(r.wechatFee).toBe(0);
    expect(r.helperAmount).toBe(0.01);
  });
});

// ============================================================
// 多段 TIERED - 大量区间
// ============================================================
describe('多段 TIERED - 大量区间', () => {
  it('10 段区间应正确计算', () => {
    const tiers: Tier[] = [];
    let start = 0;
    for (let i = 0; i < 10; i++) {
      const end = i === 9 ? null : start + 100;
      tiers.push({ rangeStart: start, rangeEnd: end, platformRate: 0.01 * (i + 1) });
      start = end as number;
    }
    // 1000 元：每段 100 元，比例 1%~10%
    // 100*1% + 100*2% + ... + 100*10% = 100*(0.01+0.02+...+0.10) = 100*0.55 = 55
    const r = calculateCommission(1000, { mode: 'TIERED', tiers });
    expect(r.platformFee).toBe(55);
    expect(r.tierBreakdown).toHaveLength(10);
  });
});
