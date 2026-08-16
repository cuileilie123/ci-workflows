/**
 * 订单号生成工具类
 *
 * 格式：2 个大写字母 + 8 位数字（共 10 位）
 * 示例：AB12345678, XY98765432
 *
 * 容量：26 × 26 × 10^8 ≈ 676 亿种组合，足够业务使用
 *
 * 两种使用方式：
 *   1) 纯函数（简单场景）：generateOrderNo() / generateUniqueOrderNo() / isValidOrderNo()
 *   2) 工具类（可配置）：new OrderNoGenerator({ letterCount: 2, digitCount: 8, maxRetries: 5 })
 */

/** 订单号正则：2 大写字母 + 8 数字 */
export const ORDER_NO_REGEX = /^[A-Z]{2}\d{8}$/;

/** 默认最大重试次数（碰撞时重试） */
const DEFAULT_MAX_RETRIES = 5;

/** 默认前缀字母数 */
const DEFAULT_LETTER_COUNT = 2;

/** 默认后缀数字位数 */
const DEFAULT_DIGIT_COUNT = 8;

// ============================================================
// 工具类 OrderNoGenerator（可配置、可扩展、方便其他模块复用）
// ============================================================

/** 工具类构造配置 */
export interface OrderNoGeneratorOptions {
  /** 前缀大写字母位数（默认 2） */
  letterCount?: number;
  /** 后缀数字位数（默认 8） */
  digitCount?: number;
  /** 碰撞时最大重试次数（默认 5） */
  maxRetries?: number;
  /** 自定义前缀字母表（默认 A-Z），可扩展为排除易混淆字母的精简表 */
  letterAlphabet?: string;
}

/**
 * 订单号生成器工具类
 *
 * 使用示例：
 * ```ts
 * // 标准订单号：2字母+8数字
 * const gen = new OrderNoGenerator();
 * const no = gen.generate();              // "AB12345678"
 * const ok = gen.isValid(no);             // true
 * const u = await gen.generateUnique(async (n) => db.exists(n));
 *
 * // 自定义：3字母+6数字，重试 8 次
 * const custom = new OrderNoGenerator({ letterCount: 3, digitCount: 6, maxRetries: 8 });
 * ```
 */
export class OrderNoGenerator {
  private readonly letterCount: number;
  private readonly digitCount: number;
  private readonly maxRetries: number;
  private readonly letterAlphabet: string;
  private readonly _regex: RegExp;

  constructor(options: OrderNoGeneratorOptions = {}) {
    this.letterCount = Math.max(1, options.letterCount ?? DEFAULT_LETTER_COUNT);
    this.digitCount = Math.max(1, options.digitCount ?? DEFAULT_DIGIT_COUNT);
    this.maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    // 自定义字母表默认使用 A-Z 简写（正则性能更好，且与 ORDER_NO_REGEX 一致）
    // 如果用户传入自定义字符串，则展开为完整字符列表
    if (options.letterAlphabet && options.letterAlphabet.length > 0) {
      this.letterAlphabet = options.letterAlphabet;
    } else {
      this.letterAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    }

    // 动态构造正则
    const letterClass =
      options.letterAlphabet && options.letterAlphabet.length > 0
        ? `[${this.escapeCharClass(this.letterAlphabet)}]`
        : '[A-Z]';
    this._regex = new RegExp(`^${letterClass}{${this.letterCount}}\\d{${this.digitCount}}$`);
  }

  /** 正则字符集转义（处理 - ] \ 等特殊字符） */
  private escapeCharClass(s: string): string {
    return s.replace(/([\]\\\-^])/g, '\\$1');
  }

  /** 获取当前配置匹配的正则 */
  get regex(): RegExp {
    return this._regex;
  }

  /** 获取总长度 */
  get length(): number {
    return this.letterCount + this.digitCount;
  }

  /**
   * 生成一个随机订单号
   */
  generate(): string {
    let letters = '';
    const alphabetSize = this.letterAlphabet.length;
    for (let i = 0; i < this.letterCount; i++) {
      letters += this.letterAlphabet.charAt(Math.floor(Math.random() * alphabetSize));
    }
    const maxDigit = Math.pow(10, this.digitCount);
    const digits = Math.floor(Math.random() * maxDigit)
      .toString()
      .padStart(this.digitCount, '0');
    return `${letters}${digits}`;
  }

  /**
   * 生成唯一订单号（带碰撞检测和重试）
   *
   * @param isUnique 回调，返回 true 表示订单号已存在（碰撞）
   * @returns 唯一的订单号
   * @throws Error 连续碰撞超过 maxRetries 次
   */
  async generateUnique(isUnique: (orderNo: string) => Promise<boolean>): Promise<string> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const orderNo = this.generate();
      const exists = await isUnique(orderNo);
      if (!exists) {
        return orderNo;
      }
    }
    throw new Error(`生成唯一订单号失败：连续 ${this.maxRetries} 次碰撞`);
  }

  /**
   * 校验订单号格式是否匹配当前生成器的配置
   */
  isValid(orderNo: string): boolean {
    return this._regex.test(orderNo);
  }

  /**
   * 校验回调返回值（辅助工具）：是否格式合法 + 长度正确
   */
  validate(orderNo: string): { valid: boolean; reason?: string } {
    if (typeof orderNo !== 'string') {
      return { valid: false, reason: '订单号必须为字符串' };
    }
    if (orderNo.length !== this.length) {
      return { valid: false, reason: `长度必须为 ${this.length}，实际为 ${orderNo.length}` };
    }
    if (!this._regex.test(orderNo)) {
      return { valid: false, reason: '格式不匹配' };
    }
    return { valid: true };
  }
}

// ============================================================
// 默认实例（订单号标准格式：2 大写字母 + 8 数字）
// ============================================================
const defaultGenerator = new OrderNoGenerator({
  letterCount: DEFAULT_LETTER_COUNT,
  digitCount: DEFAULT_DIGIT_COUNT,
  maxRetries: DEFAULT_MAX_RETRIES,
});

// ============================================================
// 纯函数导出（向后兼容，委托给默认实例）
// ============================================================

/**
 * 生成一个随机订单号（2 大写字母 + 8 数字）
 * @returns 形如 "AB12345678" 的 10 位字符串
 */
export function generateOrderNo(): string {
  return defaultGenerator.generate();
}

/**
 * 生成唯一的订单号，带碰撞检测和重试
 *
 * @param isUnique 检查订单号是否已存在的异步函数，返回 true 表示已存在（碰撞）
 * @returns 唯一的订单号
 * @throws Error 重试超过 MAX_RETRIES 次仍碰撞时抛出
 */
export async function generateUniqueOrderNo(
  isUnique: (orderNo: string) => Promise<boolean>,
): Promise<string> {
  return defaultGenerator.generateUnique(isUnique);
}

/**
 * 校验订单号格式是否合法
 * @param orderNo 待校验的字符串
 * @returns true 表示格式合法
 */
export function isValidOrderNo(orderNo: string): boolean {
  return defaultGenerator.isValid(orderNo);
}

/**
 * 当前默认生成器的最大重试次数（只读导出，供外部参考）
 */
export const ORDER_NO_MAX_RETRIES = DEFAULT_MAX_RETRIES;
