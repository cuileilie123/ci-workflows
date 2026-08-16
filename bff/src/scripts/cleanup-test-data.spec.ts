/**
 * cleanup-test-data.cjs 单元测试
 *
 * 覆盖清理脚本的核心逻辑（不连真实 DB，用 mock prisma）：
 *   1. 配置常量（测试数据前缀、单例 ID）
 *   2. parseArgs 参数解析（含错误分支 process.exit）
 *   3. isDbUnreachableError 错误识别矩阵
 *   4. probeDatabase DB 探针
 *   5. scan 扫描逻辑（前缀匹配 + 级联查询 + walletId 回退）
 *   6. cleanup 清理执行（外键依赖顺序 + target 分支 + count 统计）
 *
 * 运行：cd bff && pnpm test -- --testPathPatterns=cleanup-test-data
 */
import { Logger } from '@nestjs/common';

// 被测模块：根目录 CommonJS 脚本（无类型声明，按 any 处理）
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cleanupModule = require('../../../scripts/cleanup-test-data.cjs') as {
  parseArgs: (argv: string[]) => { confirm: boolean; yes: boolean; target: string };
  isDbUnreachableError: (e: unknown) => boolean;
  probeDatabase: () => Promise<{ ok: boolean; error?: unknown }>;
  scan: () => Promise<Record<string, unknown>>;
  cleanup: (r: Record<string, unknown>, target: string) => Promise<Record<string, number>>;
  TEST_OPENID_PREFIXES: string[];
  SINGLETON_FINANCE_ID: bigint;
  _setPrismaForTest: (mock: unknown) => void;
  _resetPrismaForTest: () => void;
};

const {
  parseArgs,
  isDbUnreachableError,
  probeDatabase,
  scan,
  cleanup,
  TEST_OPENID_PREFIXES,
  SINGLETON_FINANCE_ID,
  _setPrismaForTest,
  _resetPrismaForTest,
} = cleanupModule;

// ---- 测试日志埋点 ----
const testLogger = new Logger('CleanupSpec');
let caseNo = 0;
function logCase(scene: string, input: Record<string, unknown>, assertion: Record<string, unknown>) {
  caseNo++;
  testLogger.log(
    `[CLEANUP-TEST] Case #${String(caseNo).padStart(2, '0')} | ${scene} | 输入: ${JSON.stringify(
      input,
      (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v),
    )} | 断言: ${JSON.stringify(assertion, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v))}`,
  );
}

// ---- mock PrismaClient ----
function makeMockPrisma() {
  return {
    platformFinanceSetting: { count: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: jest.fn(), deleteMany: jest.fn() },
    wallet: { findMany: jest.fn(), deleteMany: jest.fn() },
    transaction: { findMany: jest.fn(), deleteMany: jest.fn() },
    staffPermission: { findMany: jest.fn(), deleteMany: jest.fn() },
    auditLog: { findMany: jest.fn(), deleteMany: jest.fn() },
    $disconnect: jest.fn(),
  };
}

// 屏蔽 process.exit / console 噪声（parseArgs 错误分支用）
function withSilentExit<T>(fn: () => T): T {
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`EXIT_${code}`);
  });
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    return fn();
  } finally {
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  }
}

afterEach(() => {
  _resetPrismaForTest();
  jest.restoreAllMocks();
});

// ============================================================
// 1. 配置常量
// ============================================================
describe('cleanup-test-data: 配置常量', () => {
  it('TEST_OPENID_PREFIXES 包含 4 个预期前缀', () => {
    expect(TEST_OPENID_PREFIXES).toHaveLength(4);
    expect(TEST_OPENID_PREFIXES).toContain('jest_integration_test_');
    expect(TEST_OPENID_PREFIXES).toContain('finance_setting_integration_test_');
    expect(TEST_OPENID_PREFIXES).toContain('cjs_test_finance_');
    expect(TEST_OPENID_PREFIXES).toContain('mock_user_');
    logCase('前缀配置', { 数量: TEST_OPENID_PREFIXES.length }, { 含mock_user: TEST_OPENID_PREFIXES.includes('mock_user_') });
  });

  it('SINGLETON_FINANCE_ID = 1n（财务设置单例主键）', () => {
    expect(SINGLETON_FINANCE_ID).toBe(1n);
    logCase('单例ID', {}, { id: SINGLETON_FINANCE_ID.toString() });
  });
});

// ============================================================
// 2. parseArgs 参数解析
// ============================================================
describe('cleanup-test-data: parseArgs 参数解析', () => {
  const argv = (...args: string[]) => ['node', 'cleanup-test-data.cjs', ...args];

  it('无参数 → 默认 dry-run + target=all', () => {
    const a = parseArgs(argv());
    expect(a).toEqual({ confirm: false, yes: false, target: 'all' });
    logCase('默认', {}, a);
  });

  it('--confirm → confirm=true', () => {
    expect(parseArgs(argv('--confirm')).confirm).toBe(true);
  });

  it('-y 与 --yes 都置 yes=true', () => {
    expect(parseArgs(argv('-y')).yes).toBe(true);
    expect(parseArgs(argv('--yes')).yes).toBe(true);
  });

  it.each(['users', 'finance', 'all'])('--target=%s 解析正确', (t) => {
    expect(parseArgs(argv(`--target=${t}`)).target).toBe(t);
  });

  it('--target=invalid → process.exit(1)', () => {
    expect(() => withSilentExit(() => parseArgs(argv('--target=xxx')))).toThrow('EXIT_1');
    logCase('非法target', { target: 'xxx' }, { exit: 1 });
  });

  it('-h / --help → process.exit(0)', () => {
    expect(() => withSilentExit(() => parseArgs(argv('-h')))).toThrow('EXIT_0');
    expect(() => withSilentExit(() => parseArgs(argv('--help')))).toThrow('EXIT_0');
  });

  it('未知参数 → process.exit(1)', () => {
    expect(() => withSilentExit(() => parseArgs(argv('--unknown')))).toThrow('EXIT_1');
  });

  it('组合 --confirm -y --target=users', () => {
    const a = parseArgs(argv('--confirm', '-y', '--target=users'));
    expect(a).toEqual({ confirm: true, yes: true, target: 'users' });
    logCase('组合参数', {}, a);
  });
});

// ============================================================
// 3. isDbUnreachableError 错误识别矩阵
// ============================================================
describe('cleanup-test-data: isDbUnreachableError', () => {
  const cases: Array<[unknown, boolean, string]> = [
    [{ code: 'P1001' }, true, 'P1001 不可达'],
    [{ code: 'P1003' }, true, 'P1003 库不存在'],
    [{ code: 'P1008' }, true, 'P1008 超时'],
    [{ code: 'P2010' }, true, 'P2010 查询失败'],
    [{ message: "Can't reach database server at localhost:3306" }, true, "Can't reach"],
    [{ message: "Unknown table 'platform_finance_settings'" }, true, 'Unknown table'],
    [{ message: 'ER_NO_SUCH_TABLE: table not found' }, true, 'ER_NO_SUCH_TABLE'],
    [{ message: 'Error 1146 table missing' }, true, '1146'],
    [{ message: 'connect ECONNREFUSED 127.0.0.1:3306' }, true, 'ECONNREFUSED'],
    [{ message: 'getaddrinfo ENOTFOUND db.host' }, true, 'ENOTFOUND'],
    [{ code: 'P2002', message: 'Unique constraint failed' }, false, 'P2002 唯一约束（非连接）'],
    [{ message: 'Record not found' }, false, '业务错误'],
    [{ message: 'Unauthorized' }, false, '鉴权错误'],
    [null, false, 'null'],
    [undefined, false, 'undefined'],
  ];

  it.each(cases)('%s → %s（%s）', (e, expected) => {
    expect(isDbUnreachableError(e)).toBe(expected);
  });

  it('汇总：错误识别矩阵覆盖', () => {
    const t = cases.filter(([, exp]) => exp === true).length;
    logCase('错误识别矩阵', { 总数: cases.length }, { 判为不可达: t, 判为业务错误: cases.length - t });
  });
});

// ============================================================
// 4. probeDatabase DB 探针
// ============================================================
describe('cleanup-test-data: probeDatabase', () => {
  it('count 成功 → {ok:true}', async () => {
    const p = makeMockPrisma();
    p.platformFinanceSetting.count.mockResolvedValue(0);
    _setPrismaForTest(p);
    const r = await probeDatabase();
    expect(r).toEqual({ ok: true });
    expect(p.platformFinanceSetting.count).toHaveBeenCalledTimes(1);
    logCase('探针成功', {}, r as Record<string, unknown>);
  });

  it('count 抛 P1001 → {ok:false, error}', async () => {
    const p = makeMockPrisma();
    const e = Object.assign(new Error("Can't reach"), { code: 'P1001' });
    p.platformFinanceSetting.count.mockRejectedValue(e);
    _setPrismaForTest(p);
    const r = await probeDatabase();
    expect(r.ok).toBe(false);
    expect(r.error).toBe(e);
    logCase('探针失败', { code: 'P1001' }, { ok: r.ok });
  });
});

// ============================================================
// 5. scan 扫描逻辑
// ============================================================
describe('cleanup-test-data: scan', () => {
  it('无测试用户 → report 全空，financeSetting=null，不查级联', async () => {
    const p = makeMockPrisma();
    p.user.findMany.mockResolvedValue([]);
    p.platformFinanceSetting.findUnique.mockResolvedValue(null);
    _setPrismaForTest(p);
    const r = (await scan()) as Record<string, unknown>;
    expect(r.users).toEqual([]);
    expect(r.wallets).toEqual([]);
    expect(r.transactions).toEqual([]);
    expect(r.staffPermissions).toEqual([]);
    expect(r.auditLogs).toEqual([]);
    expect(r.financeSetting).toBeNull();
    expect(p.wallet.findMany).not.toHaveBeenCalled();
    logCase('空DB', {}, { users: (r.users as unknown[]).length, finance: r.financeSetting });
  });

  it('user.findMany 的 where 含 OR + 4 个 startsWith 前缀', async () => {
    const p = makeMockPrisma();
    p.user.findMany.mockResolvedValue([]);
    p.platformFinanceSetting.findUnique.mockResolvedValue(null);
    _setPrismaForTest(p);
    await scan();
    const arg = p.user.findMany.mock.calls[0][0];
    expect(arg.where.OR).toHaveLength(4);
    expect(arg.where.OR[0]).toEqual({ openid: { startsWith: 'jest_integration_test_' } });
    expect(arg.where.OR[3]).toEqual({ openid: { startsWith: 'mock_user_' } });
    logCase('前缀查询', {}, { OR长度: arg.where.OR.length });
  });

  it('有测试用户 → 级联查询 wallets/transactions/staffPermissions/auditLogs', async () => {
    const p = makeMockPrisma();
    p.user.findMany.mockResolvedValue([
      { id: 10n, openid: 'mock_user_a', nickname: 'n', role: 'USER', createdAt: new Date() },
    ]);
    p.wallet.findMany.mockResolvedValue([{ id: 100n, userId: 10n, balance: 0 }]);
    p.transaction.findMany.mockResolvedValue([{ id: 200n, walletId: 100n, type: 'TASK_REWARD', amount: 5 }]);
    p.staffPermission.findMany.mockResolvedValue([{ id: 300n, userId: 10n, permission: 'STAFF' }]);
    p.auditLog.findMany.mockResolvedValue([{ id: 400n, adminId: 10n, action: 'X', targetType: 'T', createdAt: new Date() }]);
    p.platformFinanceSetting.findUnique.mockResolvedValue(null);
    _setPrismaForTest(p);
    const r = (await scan()) as Record<string, unknown[]>;
    expect(r.users).toHaveLength(1);
    expect(r.wallets).toHaveLength(1);
    expect(r.transactions).toHaveLength(1);
    expect(r.staffPermissions).toHaveLength(1);
    expect(r.auditLogs).toHaveLength(1);
    // walletIds 非空 → transactions 查询用 walletId in [100n]
    const txArg = p.transaction.findMany.mock.calls[0][0];
    expect(txArg.where.walletId.in).toEqual([100n]);
    logCase('级联查询', { userIds: [10n] }, { tx: r.transactions.length, walletId: txArg.where.walletId.in });
  });

  it('有用户但无钱包 → transactions 回退用 wallet.userId in userIds', async () => {
    const p = makeMockPrisma();
    p.user.findMany.mockResolvedValue([{ id: 10n, openid: 'mock_user_a', nickname: 'n', role: 'USER', createdAt: new Date() }]);
    p.wallet.findMany.mockResolvedValue([]); // 无钱包
    p.transaction.findMany.mockResolvedValue([]);
    p.staffPermission.findMany.mockResolvedValue([]);
    p.auditLog.findMany.mockResolvedValue([]);
    p.platformFinanceSetting.findUnique.mockResolvedValue(null);
    _setPrismaForTest(p);
    await scan();
    // walletIds 空 → 用 wallet.userId in [10n]
    const txArg = p.transaction.findMany.mock.calls[0][0];
    expect(txArg.where.wallet.userId.in).toEqual([10n]);
    logCase('transactions回退', { walletIds: [] }, { 回退字段: 'wallet.userId.in' });
  });
});

// ============================================================
// 6. cleanup 清理执行
// ============================================================
describe('cleanup-test-data: cleanup 执行', () => {
  const reportWith = (overrides: Record<string, unknown> = {}) => ({
    users: [],
    wallets: [],
    transactions: [],
    staffPermissions: [],
    auditLogs: [],
    financeSetting: null,
    ...overrides,
  });

  it('target=users 有用户 → 按外键顺序删 tx→wallet→staff→audit→user，不删单例', async () => {
    const p = makeMockPrisma();
    p.transaction.deleteMany.mockResolvedValue({ count: 2 });
    p.wallet.deleteMany.mockResolvedValue({ count: 1 });
    p.staffPermission.deleteMany.mockResolvedValue({ count: 0 });
    p.auditLog.deleteMany.mockResolvedValue({ count: 1 });
    p.user.deleteMany.mockResolvedValue({ count: 1 });
    p.platformFinanceSetting.deleteMany.mockResolvedValue({ count: 0 });
    _setPrismaForTest(p);
    const r = reportWith({ users: [{ id: 10n }], financeSetting: { id: 1n } });
    const stats = await cleanup(r, 'users');
    expect(stats).toEqual({ transactions: 2, wallets: 1, staffPermissions: 0, auditLogs: 1, users: 1, financeSetting: 0 });
    // 验证调用顺序递增（外键依赖：子表先于父表）
    const order = [
      p.transaction.deleteMany,
      p.wallet.deleteMany,
      p.staffPermission.deleteMany,
      p.auditLog.deleteMany,
      p.user.deleteMany,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // target=users 不删单例
    expect(p.platformFinanceSetting.deleteMany).not.toHaveBeenCalled();
    logCase('users清理顺序', { target: 'users' }, { stats, 删单例: false });
  });

  it('target=finance + financeSetting 存在 → 删单例，用 SINGLETON_FINANCE_ID', async () => {
    const p = makeMockPrisma();
    p.platformFinanceSetting.deleteMany.mockResolvedValue({ count: 1 });
    _setPrismaForTest(p);
    const r = reportWith({ financeSetting: { id: 1n } });
    const stats = await cleanup(r, 'finance');
    expect(stats.financeSetting).toBe(1);
    expect(p.platformFinanceSetting.deleteMany).toHaveBeenCalledWith({ where: { id: SINGLETON_FINANCE_ID } });
    expect(p.user.deleteMany).not.toHaveBeenCalled();
    logCase('finance清理', {}, { financeSetting: stats.financeSetting });
  });

  it('target=finance + financeSetting=null → 跳过单例删除', async () => {
    const p = makeMockPrisma();
    _setPrismaForTest(p);
    const stats = await cleanup(reportWith({ financeSetting: null }), 'finance');
    expect(stats.financeSetting).toBe(0);
    expect(p.platformFinanceSetting.deleteMany).not.toHaveBeenCalled();
    logCase('finance空跳过', {}, { financeSetting: stats.financeSetting });
  });

  it('target=all → 用户级联 + 单例都删', async () => {
    const p = makeMockPrisma();
    p.transaction.deleteMany.mockResolvedValue({ count: 1 });
    p.wallet.deleteMany.mockResolvedValue({ count: 1 });
    p.staffPermission.deleteMany.mockResolvedValue({ count: 0 });
    p.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    p.user.deleteMany.mockResolvedValue({ count: 1 });
    p.platformFinanceSetting.deleteMany.mockResolvedValue({ count: 1 });
    _setPrismaForTest(p);
    const r = reportWith({ users: [{ id: 1n }], financeSetting: { id: 1n } });
    const stats = await cleanup(r, 'all');
    expect(stats.users).toBe(1);
    expect(stats.financeSetting).toBe(1);
    logCase('all清理', {}, stats);
  });

  it('target=users 无用户 → 不删任何用户相关数据', async () => {
    const p = makeMockPrisma();
    _setPrismaForTest(p);
    const stats = await cleanup(reportWith({ users: [] }), 'users');
    expect(p.transaction.deleteMany).not.toHaveBeenCalled();
    expect(p.wallet.deleteMany).not.toHaveBeenCalled();
    expect(p.user.deleteMany).not.toHaveBeenCalled();
    logCase('无用户跳过', {}, stats);
  });

  it('count 统计正确反映 deleteMany 返回值', async () => {
    const p = makeMockPrisma();
    p.transaction.deleteMany.mockResolvedValue({ count: 7 });
    p.wallet.deleteMany.mockResolvedValue({ count: 3 });
    p.staffPermission.deleteMany.mockResolvedValue({ count: 5 });
    p.auditLog.deleteMany.mockResolvedValue({ count: 2 });
    p.user.deleteMany.mockResolvedValue({ count: 4 });
    p.platformFinanceSetting.deleteMany.mockResolvedValue({ count: 1 });
    _setPrismaForTest(p);
    const r = reportWith({ users: [{ id: 1n }], financeSetting: { id: 1n } });
    const stats = await cleanup(r, 'all');
    expect(stats.transactions).toBe(7);
    expect(stats.wallets).toBe(3);
    expect(stats.staffPermissions).toBe(5);
    expect(stats.auditLogs).toBe(2);
    expect(stats.users).toBe(4);
    expect(stats.financeSetting).toBe(1);
    logCase('count统计', {}, stats);
  });
});
