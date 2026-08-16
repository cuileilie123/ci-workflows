/**
 * verify-auth.js 单元测试
 *
 * 覆盖 6 个鉴权测试场景，通过 mock httpClient 模拟 BFF 响应，
 * 验证 runTests 的测试判定逻辑是否正确。
 *
 * 场景矩阵：
 *   1. 无 Token 访问受保护接口    → 期望 401 → PASS
 *   2. 有效 Token 访问 /auth/me   → 期望 200 → PASS
 *   3. 无效 Token 访问受保护接口  → 期望 401 → PASS
 *   4. 有效 Token 访问钱包接口    → 期望 200 → PASS
 *   5. 篡改 Token 访问应返回 401  → 期望 401 → PASS
 *   6. 登出后旧 Token 访问应 401  → 期望 401 → PASS
 *
 * 额外：truncate / TestResult 工具函数测试
 */

const { runTests, truncate, TestResult } = require('../../../scripts/verify-auth.js');

// ---------- 类型定义（JS 模块无类型，在此补充） ----------

interface HttpResponse {
  status: number;
  body: Record<string, unknown>;
}

interface ITestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  detail: string;
}

type HttpClient = (
  method: string,
  url: string,
  body?: unknown,
  token?: string | null,
) => Promise<HttpResponse>;

// ---------- Mock HTTP Client 工厂 ----------

interface MockConfig {
  // 每个端点的响应配置，key 格式: "METHOD /path"
  responses: Record<string, HttpResponse | ((args: unknown[]) => HttpResponse)>;
}

/**
 * 创建 mock httpClient
 * - 按 "METHOD /path" 匹配预设响应
 * - 支持函数形式（可根据 token 参数动态返回）
 */
function createMockHttpClient(config: MockConfig): HttpClient & { _calls: Array<{ method: string; url: string; body: unknown; token: string | null }> } {
  const calls: Array<{ method: string; url: string; body: unknown; token: string | null }> = [];

  const client = async (
    method: string,
    url: string,
    body?: unknown,
    token?: string | null,
  ): Promise<HttpResponse> => {
    // 提取 path（去掉 baseUrl 前缀和 query string）
    const urlObj = new URL(url);
    const key = `${method} ${urlObj.pathname}`;

    calls.push({ method, url, body, token: token ?? null });

    const handler = config.responses[key];
    if (!handler) {
      throw new Error(`Mock: 未配置响应 for ${key}`);
    }

    if (typeof handler === 'function') {
      return handler([method, url, body, token]);
    }
    return handler;
  };

  // 挂载调用记录，便于测试断言
  (client as unknown as { _calls: typeof calls })._calls = calls;
  return client as HttpClient & { _calls: typeof calls };
}

// 标准测试数据
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
const MOCK_REFRESH = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh.signature';
const MOCK_USER_ID = '42';
const MOCK_OPENID = 'mock_user_1234567890';

/** 标准成功场景的响应配置（全部测试应通过） */
function successResponses(): MockConfig['responses'] {
  return {
    // test-login: 返回有效 token
    'POST /api/v1/auth/test-login': {
      status: 200,
      body: {
        code: 0,
        message: 'success',
        data: {
          accessToken: MOCK_TOKEN,
          refreshToken: MOCK_REFRESH,
          expiresIn: 7200,
          user: { id: MOCK_USER_ID, openid: MOCK_OPENID, nickname: '测试用户' },
        },
      },
    },

    // /auth/me: 根据 token 返回不同结果
    'GET /api/v1/auth/me': (args: unknown[]): HttpResponse => {
      const token = args[3] as string | null;
      // 无 token → 401
      if (!token) {
        return { status: 401, body: { code: 401, message: '未登录', data: null } };
      }
      // 无效 token → 401
      if (token === 'invalid.token.here') {
        return { status: 401, body: { code: 401, message: 'Token 无效或已过期', data: null } };
      }
      // 篡改 token（末尾 5 字符被替换）→ 401
      if (token.endsWith('XXXXX')) {
        return { status: 401, body: { code: 401, message: 'Token 无效或已过期', data: null } };
      }
      // 登出后的旧 token（同 MOCK_TOKEN，但登出后应被拒）
      // 通过外部标志位控制，见下方 loggedOut 标志
      if (token === MOCK_TOKEN && loggedOut) {
        return { status: 401, body: { code: 401, message: 'Token 已失效', data: null } };
      }
      // 有效 token → 200
      return {
        status: 200,
        body: {
          code: 0,
          message: 'success',
          data: { id: MOCK_USER_ID, openid: MOCK_OPENID, nickname: '测试用户' },
        },
      };
    },

    // 钱包流水: 有效 token → 200
    'GET /api/v1/wallet/transactions': {
      status: 200,
      body: {
        code: 0,
        message: 'success',
        data: { items: [], total: 0, page: 1, pageSize: 5 },
      },
    },

    // 登出: 成功
    'POST /api/v1/auth/logout': {
      status: 200,
      body: { code: 0, message: 'success', data: { success: true } },
    },
  };
}

// 登出状态标志（供 /auth/me 的 mock 判断旧 token 是否已失效）
let loggedOut = false;

describe('verify-auth.js - runTests', () => {
  beforeEach(() => {
    loggedOut = false;
  });

  // ====== 完整成功场景：6/6 通过 ======
  describe('全部成功场景', () => {
    it('6 项测试全部通过（6/6 PASS）', async () => {
      const responses = successResponses();
      // 在登出时设置标志
      const originalLogout = responses['POST /api/v1/auth/logout'];
      responses['POST /api/v1/auth/logout'] = (args: unknown[]): HttpResponse => {
        loggedOut = true;
        return typeof originalLogout === 'function'
          ? originalLogout(args)
          : originalLogout;
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, { baseUrl: 'http://localhost:3000' })) as ITestResult[];

      expect(results).toHaveLength(6);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('结果顺序与测试矩阵一致', async () => {
      const client = createMockHttpClient({ responses: successResponses() });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[0].name).toContain('无 Token');
      expect(results[1].name).toContain('有效 Token');
      expect(results[1].name).toContain('/auth/me');
      expect(results[2].name).toContain('无效 Token');
      expect(results[3].name).toContain('wallet');
      expect(results[4].name).toContain('篡改');
      expect(results[5].name).toContain('登出');
    });
  });

  // ====== 场景 1：无 Token 访问应 401 ======
  describe('场景 1: 无 Token 访问受保护接口', () => {
    it('返回 401 时判定 PASS', async () => {
      const responses = successResponses();
      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[0].name).toContain('无 Token');
      expect(results[0].passed).toBe(true);
      expect(results[0].actual).toBe('status=401');
    });

    it('返回 200 时判定 FAIL', async () => {
      const responses = successResponses();
      // 篡改：无 token 也返回 200（安全漏洞）
      responses['GET /api/v1/auth/me'] = (): HttpResponse => ({
        status: 200,
        body: { code: 0, data: { id: MOCK_USER_ID } },
      });

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[0].passed).toBe(false);
      expect(results[0].actual).toBe('status=200');
    });
  });

  // ====== 场景 2：有效 Token 访问 /auth/me 应 200 ======
  describe('场景 2: 有效 Token 访问 /auth/me', () => {
    it('返回 200 + 匹配 userId 时判定 PASS', async () => {
      const client = createMockHttpClient({ responses: successResponses() });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[1].passed).toBe(true);
      expect(results[1].actual).toContain('status=200');
      expect(results[1].actual).toContain('code=0');
    });

    it('返回 200 但 userId 不匹配时判定 FAIL', async () => {
      const responses = successResponses();
      responses['GET /api/v1/auth/me'] = (args: unknown[]): HttpResponse => {
        const token = args[3] as string;
        if (token === MOCK_TOKEN && !loggedOut) {
          return {
            status: 200,
            body: { code: 0, data: { id: '999' } }, // 不匹配的 userId
          };
        }
        return { status: 401, body: { code: 401 } };
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[1].passed).toBe(false);
    });

    it('返回 500 时判定 FAIL', async () => {
      const responses = successResponses();
      responses['GET /api/v1/auth/me'] = (args: unknown[]): HttpResponse => {
        const token = args[3] as string;
        if (token === MOCK_TOKEN && !loggedOut) {
          return { status: 500, body: { code: 500, message: '服务器错误' } };
        }
        return { status: 401, body: { code: 401 } };
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[1].passed).toBe(false);
      expect(results[1].actual).toContain('status=500');
    });
  });

  // ====== 场景 3：无效 Token 访问应 401 ======
  describe('场景 3: 无效 Token 访问受保护接口', () => {
    it('返回 401 时判定 PASS', async () => {
      const client = createMockHttpClient({ responses: successResponses() });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[2].name).toContain('无效 Token');
      expect(results[2].passed).toBe(true);
    });

    it('返回 200 时判定 FAIL（无效 token 不应通过）', async () => {
      const responses = successResponses();
      responses['GET /api/v1/auth/me'] = (): HttpResponse => ({
        status: 200,
        body: { code: 0, data: { id: MOCK_USER_ID } },
      });

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[2].passed).toBe(false);
    });
  });

  // ====== 场景 4：有效 Token 访问钱包流水应 200 ======
  describe('场景 4: 有效 Token 访问 /wallet/transactions', () => {
    it('返回 200 + code=0 时判定 PASS', async () => {
      const client = createMockHttpClient({ responses: successResponses() });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[3].passed).toBe(true);
      expect(results[3].actual).toContain('status=200');
    });

    it('返回 403 时判定 FAIL', async () => {
      const responses = successResponses();
      responses['GET /api/v1/wallet/transactions'] = {
        status: 403,
        body: { code: 403, message: '无权访问' },
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[3].passed).toBe(false);
      expect(results[3].actual).toContain('status=403');
    });

    it('返回 200 但 code=1 时判定 FAIL', async () => {
      const responses = successResponses();
      responses['GET /api/v1/wallet/transactions'] = {
        status: 200,
        body: { code: 1, message: '业务错误' },
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[3].passed).toBe(false);
      expect(results[3].actual).toContain('code=1');
    });
  });

  // ====== 场景 5：篡改 Token 访问应 401 ======
  describe('场景 5: 篡改 Token 签名', () => {
    it('返回 401 时判定 PASS', async () => {
      const client = createMockHttpClient({ responses: successResponses() });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[4].name).toContain('篡改');
      expect(results[4].passed).toBe(true);
    });

    it('篡改的 token 末尾应为 XXXXX', async () => {
      const responses = successResponses();
      const client = createMockHttpClient({ responses });
      await runTests(client, {});

      // 找到第 5 次对 /auth/me 的调用（篡改 token 那次）
      const meCalls = (client as unknown as { _calls: Array<{ method: string; url: string; token: string | null }> })._calls
        .filter((c) => c.method === 'GET' && c.url.includes('/auth/me'));
      // meCalls[0] = 无token, [1] = 有效token, [2] = 无效token, [3] = 篡改token
      expect(meCalls[3].token).toMatch(/XXXXX$/);
    });

    it('返回 200 时判定 FAIL', async () => {
      const responses = successResponses();
      responses['GET /api/v1/auth/me'] = (): HttpResponse => ({
        status: 200,
        body: { code: 0, data: { id: MOCK_USER_ID } },
      });

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[4].passed).toBe(false);
    });
  });

  // ====== 场景 6：登出后旧 Token 访问应 401 ======
  describe('场景 6: 登出后旧 Token 失效', () => {
    it('登出后返回 401 时判定 PASS（黑名单生效）', async () => {
      const responses = successResponses();
      const originalLogout = responses['POST /api/v1/auth/logout'];
      responses['POST /api/v1/auth/logout'] = (args: unknown[]): HttpResponse => {
        loggedOut = true;
        return typeof originalLogout === 'function'
          ? originalLogout(args)
          : originalLogout;
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[5].name).toContain('登出');
      expect(results[5].passed).toBe(true);
      expect(results[5].actual).toBe('status=401');
    });

    it('登出后仍返回 200 时判定 FAIL（黑名单未生效）', async () => {
      const responses = successResponses();
      // /auth/me 始终返回 200（不检查黑名单）
      responses['GET /api/v1/auth/me'] = (args: unknown[]): HttpResponse => {
        const token = args[3] as string;
        if (!token || token === 'invalid.token.here' || token.endsWith('XXXXX')) {
          return { status: 401, body: { code: 401 } };
        }
        // 有效 token 和登出后的旧 token 都返回 200
        return {
          status: 200,
          body: { code: 0, data: { id: MOCK_USER_ID } },
        };
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results[5].passed).toBe(false);
      expect(results[5].actual).toBe('status=200');
    });

    it('登出请求应携带 refreshToken 和 accessToken', async () => {
      const responses = successResponses();
      const originalLogout = responses['POST /api/v1/auth/logout'];
      let logoutCallBody: unknown = null;
      let logoutCallToken: string | null = null;
      responses['POST /api/v1/auth/logout'] = (args: unknown[]): HttpResponse => {
        logoutCallBody = args[2];
        logoutCallToken = (args[3] as string) ?? null;
        loggedOut = true;
        return typeof originalLogout === 'function'
          ? (originalLogout as (a: unknown[]) => HttpResponse)(args)
          : originalLogout;
      };

      const client = createMockHttpClient({ responses });
      await runTests(client, {});

      expect(logoutCallBody).toEqual({ refreshToken: MOCK_REFRESH });
      expect(logoutCallToken).toBe(MOCK_TOKEN);
    });
  });

  // ====== 边界场景：test-login 失败 ======
  describe('边界: test-login 失败', () => {
    it('test-login 返回 500 时返回空结果', async () => {
      const responses: MockConfig['responses'] = {
        'POST /api/v1/auth/test-login': {
          status: 500,
          body: { code: 500, message: '服务器错误' },
        },
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results).toHaveLength(0);
    });

    it('test-login 返回 200 但无 accessToken 时返回空结果', async () => {
      const responses: MockConfig['responses'] = {
        'POST /api/v1/auth/test-login': {
          status: 200,
          body: { code: 0, data: {} }, // 无 token
        },
      };

      const client = createMockHttpClient({ responses });
      const results = (await runTests(client, {})) as ITestResult[];

      expect(results).toHaveLength(0);
    });
  });
});

// ====== 工具函数测试 ======
describe('verify-auth.js - 工具函数', () => {
  describe('truncate', () => {
    it('短字符串不截断', () => {
      expect(truncate('hello')).toBe('hello');
    });

    it('超长字符串截断并加省略号', () => {
      const long = 'a'.repeat(100);
      const result = truncate(long);
      expect(result).toHaveLength(83); // 80 + '...'
      expect(result.endsWith('...')).toBe(true);
    });

    it('恰好 maxLen 的字符串不截断', () => {
      const exact = 'b'.repeat(80);
      expect(truncate(exact)).toBe(exact);
    });

    it('自定义 maxLen', () => {
      expect(truncate('abcdefg', 3)).toBe('abc...');
    });

    it('非字符串输入自动转换', () => {
      expect(truncate(12345)).toBe('12345');
    });
  });

  describe('TestResult', () => {
    it('toString 格式正确（PASS）', () => {
      const r = new TestResult('测试名称');
      r.passed = true;
      r.expected = 'status=200';
      r.actual = 'status=200';
      r.detail = '{"ok":true}';

      const str = r.toString();
      expect(str).toContain('[PASS]');
      expect(str).toContain('测试名称');
      expect(str).toContain('expect: status=200');
      expect(str).toContain('actual: status=200');
    });

    it('toString 格式正确（FAIL）', () => {
      const r = new TestResult('失败测试');
      r.passed = false;
      r.expected = 'status=401';
      r.actual = 'status=200';
      r.detail = '{"unexpected":true}';

      const str = r.toString();
      expect(str).toContain('[FAIL]');
      expect(str).toContain('失败测试');
    });

    it('detail 超长时自动截断', () => {
      const r = new TestResult('截断测试');
      r.passed = true;
      r.detail = 'x'.repeat(200);

      const str = r.toString();
      expect(str).toContain('...');
      expect(str.length).toBeLessThan(300);
    });
  });
});
