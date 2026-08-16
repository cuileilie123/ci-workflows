/* eslint-disable no-console */
/**
 * 测试数据清理脚本
 *
 * 清理由下列测试产生的 DB 脏数据，方便下次运行（幂等，可重复执行）：
 *   - wallet 集成测试        (openid 前缀 jest_integration_test_)
 *   - finance 持久化集成测试  (openid 前缀 finance_setting_integration_test_)
 *   - auth cjs 冒烟测试       (openid 前缀 cjs_test_finance_)
 *   - test-login mock 用户    (openid 前缀 mock_user_)
 *   - 财务设置单例残留          (platform_finance_settings.id=1)
 *   - 测试用户产生的审计日志    (audit_logs.adminId IN 测试用户)
 *
 * 安全设计：
 *   - 默认 DRY-RUN（只扫描+预览，不删除）
 *   - 必须显式传 --confirm 才真正删除
 *   - 删除前打印每类匹配数 + 示例；删除后回显实际删除行数
 *   - 按外键依赖顺序清理（transactions → wallets → staff_permissions
 *     → audit_logs → users → platform_finance_settings）
 *
 * 用法：
 *   node scripts/cleanup-test-data.cjs                  # dry-run，仅预览
 *   node scripts/cleanup-test-data.cjs --confirm        # 真正清理
 *   node scripts/cleanup-test-data.cjs --confirm -y     # 跳过二次确认
 *   node scripts/cleanup-test-data.cjs --target=users   # 只清理测试用户
 *   node scripts/cleanup-test-data.cjs --target=finance # 只清理财务设置单例
 *
 * 退出码：0=成功；1=参数错误或删除异常
 */
'use strict';

const path = require('path');
const fs = require('fs');

// ============================================================
// 1. 加载 bff/.env（DATABASE_URL 在这里）
// ============================================================
const envPath = path.join(__dirname, '..', 'bff', '.env');
if (fs.existsSync(envPath)) {
  // 本地：从 bff/.env 加载（不覆盖已存在的环境变量）
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} else if (!process.env.DATABASE_URL) {
  // CI 等环境：无 .env 文件，DATABASE_URL 应由 workflow env 注入；两者皆无时报错
  console.error(`✗ 找不到 bff/.env（${envPath}）且未设置 DATABASE_URL 环境变量`);
  console.error('  本地：请在 bff/ 配置 .env；CI：请在 workflow env 设置 DATABASE_URL');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('✗ 未配置 DATABASE_URL（检查 bff/.env 或 DATABASE_URL 环境变量）');
  process.exit(1);
}

// 引入 PrismaClient（从 bff/node_modules）
const { PrismaClient } = require(
  path.join(__dirname, '..', 'bff', 'node_modules', '@prisma', 'client'),
);
let prisma = null;

// 懒加载 PrismaClient（直接运行时创建；单元测试可用 _setPrismaForTest 注入 mock）
function getPrisma() {
  if (!prisma) prisma = new PrismaClient({ log: ['warn', 'error'] });
  return prisma;
}

// ============================================================
// 2. 配置：测试数据标识前缀
// ============================================================
const SINGLETON_FINANCE_ID = 1n;

// 测试用户的 openid 前缀集合（任一匹配即视为测试数据）
const TEST_OPENID_PREFIXES = [
  'jest_integration_test_', // wallet 集成测试
  'finance_setting_integration_test_', // finance 持久化集成测试
  'cjs_test_finance_', // auth cjs 冒烟测试
  'mock_user_', // test-login 无 userId 时创建的 mock 用户
];

// ============================================================
// 3. 颜色 + 日志工具
// ============================================================
const C = {
  G: '\x1b[32m', R: '\x1b[31m', Y: '\x1b[33m',
  C: '\x1b[36m', B: '\x1b[1m', D: '\x1b[2m', X: '\x1b[0m',
};
const ts = () => new Date().toLocaleString('zh-CN', { hour12: false });
const log = (m) => console.log(`${C.D}${ts()}${C.X} ${m}`);
const ok = (m) => log(`  ${C.G}✓${C.X} ${m}`);
const warn = (m) => log(`  ${C.Y}⚠${C.X} ${m}`);
const err = (m) => log(`  ${C.R}✗${C.X} ${m}`);
const section = (t) => console.log(`\n${C.B}${C.C}─ ${t} ${C.X}${'─'.repeat(Math.max(0, 60 - t.length))}`);

// ============================================================
// 4. 命令行参数解析
// ============================================================
function parseArgs(argv) {
  const args = { confirm: false, yes: false, target: 'all' };
  for (const a of argv.slice(2)) {
    if (a === '--confirm') args.confirm = true;
    else if (a === '-y' || a === '--yes') args.yes = true;
    else if (a.startsWith('--target=')) {
      const v = a.slice('--target='.length);
      if (!['all', 'users', 'finance'].includes(v)) {
        console.error(`✗ 未知 --target 值: ${v}（可选: all | users | finance）`);
        process.exit(1);
      }
      args.target = v;
    } else if (a === '-h' || a === '--help') {
      console.log(
        '用法: node scripts/cleanup-test-data.cjs [--confirm] [-y] [--target=all|users|finance]\n' +
          '  --confirm   真正执行删除（默认 dry-run 仅预览）\n' +
          '  -y/--yes    跳过二次确认\n' +
          '  --target    选择清理范围（默认 all）\n' +
          '    users    仅清理测试用户及其级联数据\n' +
          '    finance  仅清理财务设置单例 + 审计日志',
      );
      process.exit(0);
    } else {
      console.error(`✗ 未知参数: ${a}（用 -h 查看帮助）`);
      process.exit(1);
    }
  }
  return args;
}

// ============================================================
// 5.0 DB 可达性 + 表存在性预检
//     （CI 可能尚未 migrate、本地可能未启动 DB → 友好跳过，exit 0 不阻断）
// ============================================================
async function probeDatabase() {
  try {
    // 用单例表做探针：migrate 已完成则表存在；查询成功代表 DB 可达
    await getPrisma().platformFinanceSetting.count();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

// 判断错误是否属于“DB 不可达 / 表未创建”（应跳过而非报错）
// 覆盖 Prisma 连接错误（P1001~P1004/P1008/P2010）、MySQL 表不存在、网络不可达等
function isDbUnreachableError(e) {
  const msg = String(e?.message || e);
  const code = String(e?.code || '');
  // Prisma 连接类错误码：P1001 不可达 / P1002 连接超时 / P1003 库不存在 / P1004 库名过长 / P1008 超时 / P2010 查询失败
  if (/^P10(0[1-9])$/i.test(code) || code === 'P1008' || code === 'P2010') return true;
  return /Unknown table|ER_NO_SUCH_TABLE|1146|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|getaddrinfo|Can't connect|Can't reach|reach database server|Unknown database|connect E|Please make sure your database server|Timed out|PrismaClientInitializationError/i.test(
    msg,
  );
}

// ============================================================
// 5. 扫描：返回各类测试数据的匹配清单（dry-run 与执行共用）
// ============================================================
async function scan() {
  const report = {
    users: [],
    wallets: [],
    transactions: [],
    staffPermissions: [],
    auditLogs: [],
    financeSetting: null,
  };

  // 5.1 测试用户（按 openid 前缀匹配）
  const users = await getPrisma().user.findMany({
    where: { OR: TEST_OPENID_PREFIXES.map((p) => ({ openid: { startsWith: p } })) },
    select: {
      id: true, openid: true, nickname: true, role: true, createdAt: true,
    },
    orderBy: { id: 'asc' },
  });
  report.users = users;
  const userIds = users.map((u) => u.id);

  if (userIds.length > 0) {
    // 5.2 这些用户的钱包
    report.wallets = await getPrisma().wallet.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true, balance: true },
    });
    const walletIds = report.wallets.map((w) => w.id);

    // 5.3 钱包流水
    report.transactions = await getPrisma().transaction.findMany({
      where: walletIds.length ? { walletId: { in: walletIds } } : { wallet: { userId: { in: userIds } } },
      select: { id: true, walletId: true, type: true, amount: true },
    });

    // 5.4 工作人员权限（持有或授予）
    report.staffPermissions = await getPrisma().staffPermission.findMany({
      where: { OR: [{ userId: { in: userIds } }, { grantedBy: { in: userIds } }] },
      select: { id: true, userId: true, permission: true },
    });

    // 5.5 测试用户产生的审计日志
    report.auditLogs = await getPrisma().auditLog.findMany({
      where: { adminId: { in: userIds } },
      select: { id: true, adminId: true, action: true, targetType: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
  }

  // 5.6 财务设置单例（id=1，测试会覆盖该行）
  report.financeSetting = await getPrisma().platformFinanceSetting.findUnique({
    where: { id: SINGLETON_FINANCE_ID },
    select: {
      id: true, profitSharingEnabled: true, receiverType: true,
      receiverMchId: true, mainMchId: true, updatedBy: true, updatedAt: true,
    },
  });

  return report;
}

// ============================================================
// 6. 打印扫描结果（dry-run 视图）
// ============================================================
function printReport(r, target) {
  section(`扫描结果`);

  if (target === 'all' || target === 'users') {
    log(`${C.B}① 测试用户${C.X}（openid 前缀匹配 ${TEST_OPENID_PREFIXES.length} 个）`);
    if (r.users.length === 0) {
      ok('无测试用户残留');
    } else {
      log(`  匹配 ${C.Y}${r.users.length}${C.X} 行：`);
      r.users.slice(0, 5).forEach((u) => {
        log(`    - id=${u.id} openid=${u.openid} role=${u.role} nickname=${u.nickname}`);
      });
      if (r.users.length > 5) log(`    ${C.D}... 还有 ${r.users.length - 5} 行${C.X}`);
      log(`  将级联删除：wallets=${r.wallets.length}, transactions=${r.transactions.length}, staff_permissions=${r.staffPermissions.length}`);
      log(`  关联审计日志：${r.auditLogs.length} 条（adminId 属于上述测试用户）`);
    }
  }

  if (target === 'all' || target === 'finance') {
    log(`${C.B}② 财务设置单例${C.X} (platform_finance_settings.id=1)`);
    if (!r.financeSetting) {
      ok('无单例残留（DB 无记录，已是干净状态）');
    } else {
      log(`  ${C.Y}存在 1 行单例数据${C.X}：`);
      log(`    - profitSharingEnabled=${r.financeSetting.profitSharingEnabled}`);
      log(`    - receiverType=${r.financeSetting.receiverType}, receiverMchId=${r.financeSetting.receiverMchId ?? '(空)'}`);
      log(`    - mainMchId=${r.financeSetting.mainMchId ?? '(空)'}`);
      log(`    - updatedBy=${r.financeSetting.updatedBy ?? '(null)'}, updatedAt=${r.financeSetting.updatedAt}`);
      warn('删除后 DB 回到无配置状态（get() 返回 null），不影响业务（回落 env）');
    }
    if (target === 'finance' && r.auditLogs.length > 0) {
      log(`  ${C.D}（注：--target=finance 不清理测试用户的审计日志，用 --target=all 或 users）${C.X}`);
    }
  }
}

// ============================================================
// 7. 执行删除（按外键依赖顺序）
// ============================================================
async function cleanup(r, target) {
  const stats = { transactions: 0, wallets: 0, staffPermissions: 0, auditLogs: 0, users: 0, financeSetting: 0 };
  const userIds = r.users.map((u) => u.id);

  if ((target === 'all' || target === 'users') && userIds.length > 0) {
    section('执行清理：测试用户级联');

    // 7.1 钱包流水（先于钱包删除，避免外键约束）
    const txCount = await getPrisma().transaction.deleteMany({
      where: { wallet: { userId: { in: userIds } } },
    });
    stats.transactions = txCount.count;
    ok(`transactions 删除 ${txCount.count} 行`);

    // 7.2 钱包
    const wCount = await getPrisma().wallet.deleteMany({
      where: { userId: { in: userIds } },
    });
    stats.wallets = wCount.count;
    ok(`wallets 删除 ${wCount.count} 行`);

    // 7.3 工作人员权限（持有 + 授予）
    const spCount = await getPrisma().staffPermission.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { grantedBy: { in: userIds } }] },
    });
    stats.staffPermissions = spCount.count;
    ok(`staff_permissions 删除 ${spCount.count} 行`);

    // 7.4 测试用户产生的审计日志
    const alCount = await getPrisma().auditLog.deleteMany({
      where: { adminId: { in: userIds } },
    });
    stats.auditLogs = alCount.count;
    ok(`audit_logs 删除 ${alCount.count} 行（adminId 属于测试用户）`);

    // 7.5 测试用户本身
    const uCount = await getPrisma().user.deleteMany({
      where: { id: { in: userIds } },
    });
    stats.users = uCount.count;
    ok(`users 删除 ${uCount.count} 行`);
  }

  if (target === 'all' || target === 'finance') {
    section('执行清理：财务设置单例');
    if (r.financeSetting) {
      const fCount = await getPrisma().platformFinanceSetting.deleteMany({
        where: { id: SINGLETON_FINANCE_ID },
      });
      stats.financeSetting = fCount.count;
      ok(`platform_finance_settings 删除 ${fCount.count} 行（id=1 单例）`);
    } else {
      log('  跳过：无单例数据');
    }
  }

  return stats;
}

// ============================================================
// 8. 主流程
// ============================================================
async function main() {
  const args = parseArgs(process.argv);

  const banner = [
    '═'.repeat(64),
    '🧹  测试数据清理脚本',
    '═'.repeat(64),
    `模式:         ${args.confirm ? C.R + '执行删除' + C.X : C.Y + 'DRY-RUN（仅预览）' + C.X}`,
    `清理范围:     ${args.target}`,
    `DATABASE_URL: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`,
    `执行时间:     ${ts()}`,
    `Node.js:     ${process.version}`,
    '═'.repeat(64),
  ].join('\n');
  console.log(banner);

  if (!args.confirm) {
    log(`${C.Y}当前为 DRY-RUN 模式，不会删除任何数据。加 --confirm 执行实际删除。${C.X}`);
  }

  try {
    // DB 可达性 + 表存在性预检
    // （CI 可能尚未 migrate、本地可能未启动 DB → 友好跳过，exit 0 不阻断后续流程）
    const probe = await probeDatabase();
    if (!probe.ok) {
      const e = probe.error;
      if (isDbUnreachableError(e)) {
        section('跳过清理');
        log(`${C.Y}⚠ 数据库不可达或表未创建，跳过清理${C.X}`);
        log(`  原因: ${String(e?.message || e)}`);
        log(`  ${C.D}（CI：MySQL service 未就绪或尚未 prisma migrate deploy；本地：请确认 DB 已启动且已执行迁移）${C.X}`);
        return;
      }
      throw e;
    }

    // 扫描
    section('扫描数据库');
    const r = await scan();
    printReport(r, args.target);

    // 二次确认
    if (args.confirm && !args.yes) {
      const total =
        r.users.length +
        r.wallets.length +
        r.transactions.length +
        r.staffPermissions.length +
        r.auditLogs.length +
        (r.financeSetting ? 1 : 0);
      if (total === 0) {
        log(`\n${C.G}✓ 数据库已是干净状态，无需清理。${C.X}`);
        return;
      }
      // Node.js 无 readline 同步 prompt，这里用简单方式：直接提示需加 -y
      console.log(`\n${C.Y}⚠ 即将删除上述 ${total} 项数据。${C.X}`);
      console.log(`${C.Y}  若确认无误，请加 -y 参数重新运行：${C.X}`);
      console.log(`  ${C.B}node scripts/cleanup-test-data.cjs --confirm -y${C.X}`);
      return;
    }

    // 执行
    if (args.confirm) {
      const stats = await cleanup(r, args.target);
      section('清理结果汇总');
      const totalDeleted =
        stats.transactions +
        stats.wallets +
        stats.staffPermissions +
        stats.auditLogs +
        stats.users +
        stats.financeSetting;
      log(`  transactions       : ${C.G}${stats.transactions}${C.X} 行`);
      log(`  wallets            : ${C.G}${stats.wallets}${C.X} 行`);
      log(`  staff_permissions  : ${C.G}${stats.staffPermissions}${C.X} 行`);
      log(`  audit_logs         : ${C.G}${stats.auditLogs}${C.X} 行`);
      log(`  users              : ${C.G}${stats.users}${C.X} 行`);
      log(`  platform_finance   : ${C.G}${stats.financeSetting}${C.X} 行`);
      log(`  ${C.B}合计删除: ${totalDeleted} 行${C.X}`);

      // 二次扫描确认
      section('清理后校验');
      const r2 = await scan();
      const remaining =
        r2.users.length +
        (r2.financeSetting ? 1 : 0);
      if (remaining === 0) {
        log(`  ${C.G}✓ 数据库已恢复干净状态，可放心重新运行测试。${C.X}`);
      } else {
        warn(`仍有残留：users=${r2.users.length}, finance=${r2.financeSetting ? 1 : 0}`);
        warn('可能原因：删除过程中有新的测试写入；再次运行即可。');
      }
    } else {
      // dry-run 汇总
      const totalPreview =
        r.users.length +
        r.wallets.length +
        r.transactions.length +
        r.staffPermissions.length +
        r.auditLogs.length +
        (r.financeSetting ? 1 : 0);
      section('DRY-RUN 汇总');
      if (totalPreview === 0) {
        log(`  ${C.G}✓ 未发现测试脏数据，数据库已是干净状态。${C.X}`);
      } else {
        log(`  ${C.Y}预览待清理 ${totalPreview} 项${C.X}：`);
        log(`    users=${r.users.length}, wallets=${r.wallets.length}, transactions=${r.transactions.length}`);
        log(`    staff_permissions=${r.staffPermissions.length}, audit_logs=${r.auditLogs.length}`);
        log(`    platform_finance_settings=${r.financeSetting ? 1 : 0}`);
        log(`\n  ${C.B}确认无误后执行：node scripts/cleanup-test-data.cjs --confirm -y${C.X}`);
      }
    }
  } catch (e) {
    // 清理执行中途的 DB 不可达同样友好跳过，不阻断 CI
    if (isDbUnreachableError(e)) {
      warn(`清理过程中数据库不可达，已中止: ${String(e?.message || e)}`);
      return;
    }
    err(`清理过程异常: ${e.message}`);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await getPrisma().$disconnect();
    log(`数据库连接已断开`);
  }
}

// 仅在直接运行时执行（require 时不自动跑，便于单元测试导入核心函数）
if (require.main === module) {
  main();
}

// ============================================================
// 9. 导出（供单元测试覆盖核心逻辑）
// ============================================================
module.exports = {
  parseArgs,
  isDbUnreachableError,
  probeDatabase,
  scan,
  cleanup,
  printReport,
  main,
  TEST_OPENID_PREFIXES,
  SINGLETON_FINANCE_ID,
  // 测试专用：注入/重置 mock prisma（避免创建真实 client 连接 DB）
  _setPrismaForTest(mock) {
    prisma = mock;
  },
  _resetPrismaForTest() {
    prisma = null;
  },
};
