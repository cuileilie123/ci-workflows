import {
  ORDER_NO_REGEX,
  ORDER_NO_MAX_RETRIES,
  OrderNoGenerator,
  OrderNoGeneratorOptions,
  generateOrderNo,
  generateUniqueOrderNo,
  isValidOrderNo,
} from './order-no.util';

// ============================================================
// 常量
// ============================================================
describe('常量导出', () => {
  it('ORDER_NO_REGEX 应为 /^[A-Z]{2}\\d{8}$/', () => {
    expect(ORDER_NO_REGEX.source).toBe('^[A-Z]{2}\\d{8}$');
  });

  it('ORDER_NO_MAX_RETRIES 应为 5', () => {
    expect(ORDER_NO_MAX_RETRIES).toBe(5);
  });
});

// ============================================================
// 纯函数（向后兼容）
// ============================================================
describe('纯函数 API（向后兼容）', () => {
  describe('generateOrderNo', () => {
    it('返回长度 10', () => expect(generateOrderNo()).toHaveLength(10));
    it('格式匹配 ORDER_NO_REGEX（500 次抽样）', () => {
      for (let i = 0; i < 500; i++) {
        expect(ORDER_NO_REGEX.test(generateOrderNo())).toBe(true);
      }
    });
    it('10000 次生成碰撞数 < 100', () => {
      const s = new Set<string>();
      for (let i = 0; i < 10000; i++) s.add(generateOrderNo());
      expect(s.size).toBeGreaterThan(9900);
    });
  });

  describe('isValidOrderNo', () => {
    it('AB12345678 → true', () => expect(isValidOrderNo('AB12345678')).toBe(true));
    it('ab12345678 → false', () => expect(isValidOrderNo('ab12345678')).toBe(false));
    it('长度 9 → false', () => expect(isValidOrderNo('AB1234567')).toBe(false));
    it('空 → false', () => expect(isValidOrderNo('')).toBe(false));
  });

  describe('generateUniqueOrderNo', () => {
    it('无碰撞 → 1 次回调 + 合法订单号', async () => {
      let count = 0;
      const no = await generateUniqueOrderNo(async () => { count++; return false; });
      expect(count).toBe(1);
      expect(isValidOrderNo(no)).toBe(true);
    });

    it('前 4 次碰撞 → 第 5 次成功', async () => {
      let attempt = 0;
      const no = await generateUniqueOrderNo(async () => { attempt++; return attempt < 5; });
      expect(attempt).toBe(5);
      expect(isValidOrderNo(no)).toBe(true);
    });

    it('5 次碰撞 → 抛异常', async () => {
      let count = 0;
      await expect(generateUniqueOrderNo(async () => { count++; return true; }))
        .rejects.toThrow('5');
      expect(count).toBe(5);
    });
  });
});

// ============================================================
// 工具类 OrderNoGenerator
// ============================================================
describe('OrderNoGenerator 工具类', () => {

  // ------------------------------------------------------------
  // 默认配置（标准订单号）
  // ------------------------------------------------------------
  describe('默认配置（letterCount=2, digitCount=8, maxRetries=5）', () => {
    const gen = new OrderNoGenerator();

    it('length 为 10', () => expect(gen.length).toBe(10));
    it('regex 与 ORDER_NO_REGEX 等价', () => {
      expect(gen.regex.source).toBe(ORDER_NO_REGEX.source);
    });

    it('generate() 返回合法订单号（200 次）', () => {
      for (let i = 0; i < 200; i++) {
        const no = gen.generate();
        expect(no).toHaveLength(10);
        expect(gen.isValid(no)).toBe(true);
        expect(isValidOrderNo(no)).toBe(true);
      }
    });

    it('isValid 对合法值返回 true', () => {
      expect(gen.isValid('AB12345678')).toBe(true);
      expect(gen.isValid('AA00000000')).toBe(true);
      expect(gen.isValid('ZZ99999999')).toBe(true);
    });

    it('isValid 对非法值返回 false', () => {
      expect(gen.isValid('AB1234567')).toBe(false);
      expect(gen.isValid('ab12345678')).toBe(false);
      expect(gen.isValid('12AB345678')).toBe(false);
    });

    it('generateUnique() 成功', async () => {
      let calls = 0;
      const no = await gen.generateUnique(async () => { calls++; return false; });
      expect(calls).toBe(1);
      expect(gen.isValid(no)).toBe(true);
    });

    it('generateUnique() 5 次碰撞抛异常', async () => {
      let count = 0;
      await expect(gen.generateUnique(async () => { count++; return true; }))
        .rejects.toThrow('5');
      expect(count).toBe(5);
    });

    it('validate() 合法订单号返回 valid:true', () => {
      expect(gen.validate('AB12345678')).toEqual({ valid: true });
    });

    it('validate() 非字符串 → 给出原因', () => {
      expect(gen.validate(123 as any)).toEqual({ valid: false, reason: '订单号必须为字符串' });
    });

    it('validate() 长度错误 → 给出原因', () => {
      const r = gen.validate('AB1234567');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/长度/);
    });

    it('validate() 格式错误 → 给出原因', () => {
      const r = gen.validate('AB-2345678');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/格式/);
    });
  });

  // ------------------------------------------------------------
  // 自定义配置
  // ------------------------------------------------------------
  describe('自定义配置', () => {
    it('letterCount=3 → 长度 11（3+8）', () => {
      const g = new OrderNoGenerator({ letterCount: 3 });
      expect(g.length).toBe(11);
      const no = g.generate();
      expect(no).toHaveLength(11);
      expect(/^[A-Z]{3}\d{8}$/.test(no)).toBe(true);
      expect(g.isValid(no)).toBe(true);
    });

    it('digitCount=6 → 长度 8（2+6）', () => {
      const g = new OrderNoGenerator({ digitCount: 6 });
      expect(g.length).toBe(8);
      const no = g.generate();
      expect(no).toHaveLength(8);
      expect(/^[A-Z]{2}\d{6}$/.test(no)).toBe(true);
    });

    it('letterCount=3, digitCount=6 → 长度 9', () => {
      const g = new OrderNoGenerator({ letterCount: 3, digitCount: 6 });
      expect(g.length).toBe(9);
      for (let i = 0; i < 100; i++) {
        expect(g.generate()).toHaveLength(9);
      }
    });

    it('maxRetries=8 → 8 次碰撞抛异常包含 "8"', async () => {
      const g = new OrderNoGenerator({ maxRetries: 8 });
      let count = 0;
      try {
        await g.generateUnique(async () => { count++; return true; });
        fail('should throw');
      } catch (err: any) {
        expect(err.message).toMatch(/8/);
        expect(count).toBe(8);
      }
    });

    it('maxRetries=3 → 3 次碰撞抛异常包含 "3"', async () => {
      const g = new OrderNoGenerator({ maxRetries: 3 });
      let count = 0;
      await expect(g.generateUnique(async () => { count++; return true; }))
        .rejects.toThrow('3');
      expect(count).toBe(3);
    });

    it('letterCount=1, digitCount=1 → 长度 2', () => {
      const g = new OrderNoGenerator({ letterCount: 1, digitCount: 1 });
      expect(g.length).toBe(2);
      const no = g.generate();
      expect(/^[A-Z]\d$/.test(no)).toBe(true);
      expect(g.isValid(no)).toBe(true);
    });

    it('letterCount 参数 < 1 时被 clamp 为 1', () => {
      const g = new OrderNoGenerator({ letterCount: 0 });
      expect(g.length).toBe(9); // 1 + 8
      expect(/^[A-Z]\d{8}$/.test(g.generate())).toBe(true);
    });

    it('digitCount 参数 < 1 时被 clamp 为 1', () => {
      const g = new OrderNoGenerator({ digitCount: -5 });
      expect(g.length).toBe(3); // 2 + 1
      expect(/^[A-Z]{2}\d$/.test(g.generate())).toBe(true);
    });

    it('自定义 letterAlphabet: "ABCDEF"（仅 6 个字母）', () => {
      const alphabet = 'ABCDEF';
      const g = new OrderNoGenerator({ letterCount: 3, letterAlphabet: alphabet });
      for (let i = 0; i < 500; i++) {
        const no = g.generate();
        const letters = no.slice(0, 3);
        for (const ch of letters) {
          expect(alphabet.includes(ch)).toBe(true);
        }
        expect(g.isValid(no)).toBe(true);
      }
      // 非字母表字母应不通过
      expect(g.isValid('ZAB12345678')).toBe(false); // Z 不在字母表
    });

    it('自定义 letterAlphabet 含特殊字符需正确转义（不崩溃）', () => {
      // 含正则字符类特殊字符：- ] \
      const g = new OrderNoGenerator({ letterAlphabet: 'A-Z' });
      // 只校验能生成并能验证，不抛出
      expect(typeof g.generate()).toBe('string');
      expect(g.regex instanceof RegExp).toBe(true);
    });
  });

  // ------------------------------------------------------------
  // 实例间隔离
  // ------------------------------------------------------------
  describe('实例间相互隔离', () => {
    it('不同实例互不影响：3 字母 vs 2 字母', () => {
      const g3 = new OrderNoGenerator({ letterCount: 3 });
      const g2 = new OrderNoGenerator({ letterCount: 2 });
      expect(g3.length).toBe(11);
      expect(g2.length).toBe(10);
      expect(g3.generate()).toHaveLength(11);
      expect(g2.generate()).toHaveLength(10);
    });

    it('不同实例 maxRetries 独立', async () => {
      const g8 = new OrderNoGenerator({ maxRetries: 8 });
      const g3 = new OrderNoGenerator({ maxRetries: 3 });
      let c8 = 0, c3 = 0;
      try { await g8.generateUnique(async () => { c8++; return true; }); } catch (_) {}
      try { await g3.generateUnique(async () => { c3++; return true; }); } catch (_) {}
      expect(c8).toBe(8);
      expect(c3).toBe(3);
    });
  });
});

// ============================================================
// 工具类：generateUnique 并发场景
// ============================================================
describe('OrderNoGenerator 并发场景', () => {
  class MockDB {
    private data = new Set<string>();
    async exists(n: string): Promise<boolean> {
      await new Promise(r => setTimeout(r, 0.1 + Math.random() * 0.9));
      return this.data.has(n);
    }
    save(n: string) { this.data.add(n); }
    get size() { return this.data.size; }
  }

  it('默认实例：并发 100 个 → 全部唯一', async () => {
    const db = new MockDB();
    const gen = new OrderNoGenerator();
    const results = await Promise.all(Array.from({ length: 100 }, async () => {
      const no = await gen.generateUnique(async n => db.exists(n));
      db.save(no); return no;
    }));
    expect(new Set(results).size).toBe(100);
    expect(db.size).toBe(100);
  });

  it('3 字母实例：并发 50 个 → 全部唯一', async () => {
    const db = new MockDB();
    const gen = new OrderNoGenerator({ letterCount: 3, digitCount: 6 });
    const results = await Promise.all(Array.from({ length: 50 }, async () => {
      const no = await gen.generateUnique(async n => db.exists(n));
      db.save(no); return no;
    }));
    results.forEach(n => expect(gen.isValid(n)).toBe(true));
    expect(new Set(results).size).toBe(50);
  });

  it('自定义 maxRetries：并发请求中各自独立计数', async () => {
    const gen = new OrderNoGenerator({ maxRetries: 4 });
    const attempts: Record<string, number> = {};
    await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      let a = 0;
      const key = `r${i}`;
      return gen.generateUnique(async () => {
        a++;
        attempts[key] = a;
        return a < 3; // 每请求碰撞 2 次，远低于 maxRetries=4
      });
    }));
    Object.values(attempts).forEach(a => expect(a).toBe(3));
  });
});
