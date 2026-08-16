/**
 * cleanup-test-data.cjs 集成测试（真实 DB，模拟 CI 环境）
 *
 * 模拟 GitHub Actions ci.yml 的 "Clean test data (before tests)" 步骤，
 * 端到端验证整个清理流程（调用 main()，走完整真实路径）：
 *   场景 1：CI 主流程 —— DB 有上轮残留 → main(--confirm -y) → 清理成功 + DB 干净
 *   场景 2：CI 空跑     —— DB 无脏数据 → main → 显示干净状态，不删任何东西
 *   场景 3：dry-run     —— main() 不带 --confirm → 不删除（本地预览安全性）
 *   场景 4：CI 容错     —— MySQL 未就绪(P1001) → main 友好跳过 exit 0，不阻断后续步骤
 *   场景 5：CI 容错     —— 表未 migrate(P2010) → main 友好跳过 exit 0
 *
 * 运行：cd bff && npx jest --config jest.integration.config.ts --testPathPatterns="scripts/cleanup-test-data.integration"
 */
import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

// 被测模块：根目录 CommonJS 脚本
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cleanupModule = require('../../../scripts/cleanup-test-data.cjs') as {
  main: () => Promise<void>;
  _setPrismaForTest: (mock: unknown) => void;
  _resetPrismaForTest: () => void;
};
const { main, _setPrismaForTest, _resetPrismaForTest } = cleanupModule;

// 测试专用 prisma（用于注入/验证脏数据，与 main 的内部 client 独立）
const prisma = new PrismaClient();
const testLogger = new Logger('CleanupIntegrationSpec');

const DIRTY_OPENID_PREFIX = 'mock_user_ci_';

let caseNo = 0;
function logCase(scene: string, input: Record<string, unknown>, assertion: Record<string, unknown>) {
  caseNo++;
  testLogger.log(
    `[CI-INT] Case #${String(caseNo).padStart(2, '0')} | ${scene} | 输入: ${JSON.stringify(
      input,
      (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v),
    )} | 断言: ${JSON.stringify(assertion, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v))}`,
  );
}

// ---- 工具：运行 main 并捕获 console 输出 + exitCode ----
async function runMain(...args: string[]): Promise<{ exitCode: number; logs: string[] }> {
  const origArgv = process.argv;
  process.argv = ['node', 'cleanup-test-data.cjs', ...args];
  process.exitCode = 0;
  const logs: string[] = [];
  const logSpy = jest.spyOn(console, 'log').mockImplementation((...a) => {
    logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  });
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await main();
    return { exitCode: process.exitCode ?? 0, logs };
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.argv = origArgv;
  }
}

// ---- 工具：注入脏数据（模拟上轮 CI 崩溃残留）----
async function injectDirtyData() {
  const ts = Date.now();
  const u1 = await prisma.user.create({
    data: { openid: DIRTY_OPENID_PREFIX + 'a_' + ts, nickname: 'CI集成脏数据1', role: 'USER', status: 'ACTIVE', creditScore: 100 },
  });
  const u2 = await prisma.user.create({
    data: { openid: DIRTY_OPENID_PREFIX + 'b_' + ts, nickname: 'CI集成脏数据2', role: 'USER', status: 'ACTIVE', creditScore: 100 },
  });
  // u1 有钱包（验证级联删 wallet）
  await prisma.wallet.create({ data: { userId: u1.id, balance: 0 } });
  // 财务设置单例
  await prisma.platformFinanceSetting.create({
    data: { id: 1n, profitSharingEnabled: true, receiverType: 'MERCHANT_ID', receiverMchId: '1600CIINTDIRTY', mainMchId: '1600CIINTMAIN', updatedBy: u1.id },
  });
  // 审计日志（adminId 属于测试用户 → 会被清理脚本清理）
  await prisma.auditLog.create({
    data: { action: 'FINANCE_SETTING_CREATE', targetType: 'PlatformFinanceSetting', targetId: 1n, adminId: u1.id, ip: '10.0.0.99', detail: { note: 'CI集成测试残留' } },
  });
  return { u1, u2 };
}

// ---- 工具：查询残留脏数据计数 ----
async function countDirtyData() {
  const users = await prisma.user.count({ where: { openid: { startsWith: DIRTY_OPENID_PREFIX } } });
  const wallets = await prisma.wallet.count({ where: { user: { openid: { startsWith: DIRTY_OPENID_PREFIX } } } });
  const finance = await prisma.platformFinanceSetting.count();
  return { users, wallets, finance };
}

// ---- 工具：清空测试脏数据（幂等）----
async function purgeDirtyData() {
  await prisma.auditLog.deleteMany({ where: { targetType: 'PlatformFinanceSetting', targetId: 1n } }).catch(() => {});
  await prisma.transaction.deleteMany({ where: { wallet: { user: { openid: { startsWith: DIRTY_OPENID_PREFIX } } } } }).catch(() => {});
  await prisma.wallet.deleteMany({ where: { user: { openid: { startsWith: DIRTY_OPENID_PREFIX } } } }).catch(() => {});
  await prisma.platformFinanceSetting.deleteMany({ where: { id: 1n } }).catch(() => {});
  await prisma.user.deleteMany({ where: { openid: { startsWith: DIRTY_OPENID_PREFIX } } }).catch(() => {});
}

// ---- DB 可达性预检 ----
let dbAvailable = true;
beforeAll(async () => {
  try {
    await prisma.platformFinanceSetting.count();
    testLogger.log(`[CI-INT] DB 可达，开始集成测试`);
  } catch (e) {
    dbAvailable = false;
    testLogger.warn(`[CI-INT] DB 不可达，真实 DB 场景将跳过：${(e as Error).message}`);
  }
}, 30000);

afterAll(async () => {
  await purgeDirtyData();
  await prisma.$disconnect();
  testLogger.log(`[CI-INT] 集成测试完成，DB 连接已断开`);
}, 30000);

beforeEach(async () => {
  _resetPrismaForTest();
  process.exitCode = 0;
  await purgeDirtyData();
});

afterEach(() => {
  _resetPrismaForTest();
});

// ============================================================
// 场景 1-3：CI 主流程（真实 DB）
// ============================================================
describe('CI 集成：真实 DB 清理主流程', () => {
  it('场景1：DB 有上轮残留 → main(--confirm -y) → 脏数据被清理，exit 0', async () => {
    if (!dbAvailable) {
      testLogger.warn('跳过：DB 不可达');
      return;
    }
    await injectDirtyData();
    const before = await countDirtyData();
    expect(before.users).toBe(2);
    expect(before.wallets).toBe(1);
    expect(before.finance).toBe(1);

    const { exitCode, logs } = await runMain('--confirm', '-y');

    const after = await countDirtyData();
    expect(after.users).toBe(0);
    expect(after.wallets).toBe(0);
    expect(after.finance).toBe(0);
    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('干净');
    logCase('CI主流程', { 注入: before }, { 清理后: after, exitCode, 通过: exitCode === 0 && after.users === 0 });
  }, 60000);

  it('场景2：DB 无脏数据 → main(--confirm -y) → 显示干净状态，不删任何东西', async () => {
    if (!dbAvailable) {
      testLogger.warn('跳过：DB 不可达');
      return;
    }
    const { exitCode, logs } = await runMain('--confirm', '-y');
    const after = await countDirtyData();
    expect(after.users).toBe(0);
    expect(after.finance).toBe(0);
    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('干净');
    logCase('空DB', {}, { exitCode, 通过: exitCode === 0 });
  }, 60000);

  it('场景3：dry-run 模式 → 不删除任何数据，脏数据仍存在', async () => {
    if (!dbAvailable) {
      testLogger.warn('跳过：DB 不可达');
      return;
    }
    await injectDirtyData();
    const before = await countDirtyData();
    const { exitCode } = await runMain(); // 无 --confirm → dry-run
    const after = await countDirtyData();
    expect(after.users).toBe(before.users);
    expect(after.wallets).toBe(before.wallets);
    expect(after.finance).toBe(before.finance);
    expect(exitCode).toBe(0);
    logCase('dry-run不删', { 注入: before }, { 清理后: after, 通过: after.users === before.users });
  }, 60000);
});

// ============================================================
// 场景 4-5：CI 容错（DB 不可达，用 mock 注入，不依赖真实 DB）
// ============================================================
describe('CI 集成：DB 不可达容错（模拟 CI MySQL service 未就绪）', () => {
  it('场景4：MySQL 未就绪(P1001) → main 友好跳过，exit 0 不阻断后续步骤', async () => {
    const unreachableError = Object.assign(new Error("Can't reach database server at `localhost`:3306"), { code: 'P1001' });
    const mockPrisma = {
      platformFinanceSetting: { count: jest.fn().mockRejectedValue(unreachableError) },
      $disconnect: jest.fn(),
    };
    _setPrismaForTest(mockPrisma);

    const { exitCode, logs } = await runMain('--confirm', '-y');

    expect(exitCode).toBe(0); // 关键：CI 步骤不阻断
    expect(logs.join('\n')).toContain('跳过清理');
    expect(mockPrisma.platformFinanceSetting.count).toHaveBeenCalled();
    logCase('DB不可达容错', { code: 'P1001' }, { exitCode, 跳过: exitCode === 0 });
  }, 30000);

  it('场景5：表未 migrate(P2010 Unknown table) → main 友好跳过，exit 0', async () => {
    const tableError = Object.assign(new Error("Unknown table 'platform_finance_settings'"), { code: 'P2010' });
    const mockPrisma = {
      platformFinanceSetting: { count: jest.fn().mockRejectedValue(tableError) },
      $disconnect: jest.fn(),
    };
    _setPrismaForTest(mockPrisma);

    const { exitCode, logs } = await runMain('--confirm', '-y');
    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('跳过清理');
    logCase('表不存在容错', { code: 'P2010' }, { exitCode, 跳过: exitCode === 0 });
  }, 30000);
});
