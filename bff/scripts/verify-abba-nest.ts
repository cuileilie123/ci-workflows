/* 【模式 A：单进程内真实并发调用 WalletService.transfer】
 * 直接通过 NestFactory.createApplicationContext 加载 WalletModule，
 * 并发触发 A→B / B→A 双向 transfer，配合 wallet.service.ts 新加的
 * logger.info 能清楚看到锁顺序、每次 SELECT ... FOR UPDATE 获取的先后、
 * UPDATE-1/2 顺序，真正验证 AB-BA 死锁修复逻辑。
 *
 * 运行（在 bff 目录下）：
 *   node scripts/setup-abba-test-data.cjs            # 先准备用户 A/B + 初始余额
 *   npx ts-node --project tsconfig.json scripts/verify-abba-nest.ts
 *
 * 可选环境变量：
 *   ROUNDS=40       # 每方向并发多少轮（默认 30）
 *   AMOUNT=10       # 每次转账金额（默认随机 1-20）
 *   DEADLOCK_WAIT=35000  # 单条 transfer 超时 ms（默认 35s）
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, Module, OnModuleInit, OnModuleDestroy, Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { PrismaService } from '../src/prisma/prisma.service';

// 仅在 DRY_RUN=1 生效：跳过 onModuleInit 里的 $connect()，让「没有 MySQL 时」也能自检
// Nest 模块解析 + WalletService 构造（不跑业务）。普通真实测试不会走该类。
@Injectable()
class DryRunPrismaService extends PrismaService implements OnModuleInit, OnModuleDestroy {
  override async onModuleInit(): Promise<void> {
    if (process.env.DRY_RUN === '1') {
      // 不做 $connect，直接返回（后续不访问 prisma，因为 DRY_RUN 会 return）
      return;
    }
    return super.onModuleInit();
  }
}

// 只加载「死锁复现所需的最小依赖」：WalletService + PrismaService + ConfigModule。
// 不加载 WalletController / Auth（避免额外引入 JwtAuthGuard → JwtService/TokenBlacklistService 等），
// 也不加载 ChatModule/Mongoose 模块（避免 ts-node 下反射 union 类型装饰器报错）。
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
  ],
  providers: [
    WalletService,
    {
      provide: PrismaService,
      useClass: DryRunPrismaService,
    },
  ],
})
class ABBAVerifyAppModule {}

const TEST_PREFIX = 'abba_lock_fix_test';
const OPENID_A = `${TEST_PREFIX}_userA`;
const OPENID_B = `${TEST_PREFIX}_userB`;

const ROUNDS = Number(process.env.ROUNDS ?? 30);
const AMOUNT = process.env.AMOUNT ? Number(process.env.AMOUNT) : 0; // 0=随机 1-20
const DEADLOCK_WAIT = Number(process.env.DEADLOCK_WAIT ?? 35_000);

type Stat = {
  success: number;
  failInsufficient: number;
  failConflict: number;
  failOther: number;
  deadlockSuspect: number; // 超时或显式 Deadlock found
};

function newStat(): Stat {
  return { success: 0, failInsufficient: 0, failConflict: 0, failOther: 0, deadlockSuspect: 0 };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} 超时 ${ms}ms，疑似 AB-BA 死锁或锁等待过长`);
      (err as any).deadlockSuspect = true;
      reject(err);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function classify(stat: Stat, err: any) {
  const msg: string = (err?.message ?? String(err)).toLowerCase();
  if (err?.deadlockSuspect || /deadlock|lock wait timeout|deadlock found/.test(msg)) {
    stat.deadlockSuspect++;
    return;
  }
  if (/余额不足|insufficient/.test(msg)) {
    stat.failInsufficient++;
    return;
  }
  if (/conflict/.test(msg)) {
    stat.failConflict++;
    return;
  }
  stat.failOther++;
}

const fmt = (n: number) => String(n).padStart(4, ' ');

async function main() {
  const root = new Logger('ABBA-VERIFY');
  root.log('启动 Nest 应用上下文...（会加载 Prisma + WalletModule，第一次略慢）');
  const app = await NestFactory.createApplicationContext(ABBAVerifyAppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const walletSvc = app.get(WalletService);
  const prisma = app.get(PrismaService);

  // DRY_RUN=1 时只做自检：把 Nest 上下文拉到能拿到 walletService / prisma 即成功，不连 DB。
  // 用于在没有 MySQL 时也能验证：脚本语法、Nest 模块依赖解析、WalletService/transfer 已就绪。
  if (process.env.DRY_RUN === '1') {
    root.log('[DRY_RUN=1] 仅自检：不访问数据库，已拿到 WalletService/PrismaService 即算通过。');
    root.log(`  typeof walletSvc.transfer = ${typeof walletSvc.transfer}`);
    await app.close();
    root.log('DRY_RUN 自检通过：等 MySQL 在 3306 就绪后即可去掉 DRY_RUN 运行真实并发测试。');
    return;
  }

  try {
    const a = await prisma.user.findUnique({
      where: { openid: OPENID_A },
      include: { wallet: true },
    });
    const b = await prisma.user.findUnique({
      where: { openid: OPENID_B },
      include: { wallet: true },
    });
    if (!a || !a.wallet || !b || !b.wallet) {
      root.error('测试用户 A/B 或钱包不存在，请先运行：node scripts/setup-abba-test-data.cjs');
      process.exitCode = 2;
      return;
    }

    root.log(`用户A id=${a.id} 初始余额=${Number(a.wallet.balance)}`);
    root.log(`用户B id=${b.id} 初始余额=${Number(b.wallet.balance)}`);
    const totalBefore = Number(a.wallet.balance) + Number(b.wallet.balance);
    root.log(`双方总余额=${totalBefore.toFixed(2)} (后续会校验总额守恒)`);

    root.log(`即将并发：A→B 转账 ${ROUNDS} 次 + B→A 转账 ${ROUNDS} 次（单条超时 ${DEADLOCK_WAIT}ms）`);
    root.log(`观察要点：wallet.service 的 logger 中，🔒[XFR-xxx] [LOCK-1/2] 永远先锁较小的 userId 再锁较大的 userId。`);

    const stat = newStat();
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const amt = AMOUNT > 0 ? AMOUNT : Math.floor(Math.random() * 20) + 1;
      // A→B
      tasks.push(
        (async () => {
          try {
            await withTimeout(
              walletSvc.transfer(a.id, b.id, amt, `ABBA-并发A→B#${i}`),
              DEADLOCK_WAIT,
              `A→B#${i}`,
            );
            stat.success++;
          } catch (e: any) {
            classify(stat, e);
            root.warn(`A→B#${i} 失败：${e?.message ?? String(e)}`);
          }
        })(),
      );
      // B→A（制造 AB-BA 交叉方向，与上一个同 batch 同时 start）
      const amt2 = AMOUNT > 0 ? AMOUNT : Math.floor(Math.random() * 20) + 1;
      tasks.push(
        (async () => {
          try {
            await withTimeout(
              walletSvc.transfer(b.id, a.id, amt2, `ABBA-并发B→A#${i}`),
              DEADLOCK_WAIT,
              `B→A#${i}`,
            );
            stat.success++;
          } catch (e: any) {
            classify(stat, e);
            root.warn(`B→A#${i} 失败：${e?.message ?? String(e)}`);
          }
        })(),
      );
    }

    const t0 = Date.now();
    await Promise.all(tasks);
    const cost = Date.now() - t0;

    const wa = await prisma.wallet.findUnique({ where: { userId: a.id } });
    const wb = await prisma.wallet.findUnique({ where: { userId: b.id } });
    const balA = wa ? Number(wa.balance) : NaN;
    const balB = wb ? Number(wb.balance) : NaN;
    const totalAfter = balA + balB;

    console.log('');
    console.log('================ AB-BA 并发转账 结果汇总 ================');
    console.log(`耗时：${cost} ms，合计任务 ${2 * ROUNDS} 条`);
    console.log(`成功      ：${fmt(stat.success)}`);
    console.log(`余额不足  ：${fmt(stat.failInsufficient)}  (非失败，属于正常拦截)`);
    console.log(`其他冲突  ：${fmt(stat.failConflict)}`);
    console.log(`其他异常  ：${fmt(stat.failOther)}`);
    console.log(`疑似死锁* ：${fmt(stat.deadlockSuspect)}  (* 超时或报文中含 deadlock / lock wait timeout)`);
    console.log('');
    console.log(`A 余额：${Number(a.wallet.balance).toFixed(2)} → ${balA.toFixed(2)}`);
    console.log(`B 余额：${Number(b.wallet.balance).toFixed(2)} → ${balB.toFixed(2)}`);
    console.log(`合计：${totalBefore.toFixed(2)} → ${totalAfter.toFixed(2)}`);

    const ok =
      stat.deadlockSuspect === 0 &&
      Math.abs(totalAfter - totalBefore) < 0.001;

    if (ok) {
      console.log('\x1b[32m%s\x1b[0m', '✅ AB-BA 修复验证通过：无死锁 + 总金额守恒。');
      console.log(
        '    观察 wallet.service 日志里每次 [SORT-KEY]：比较 firstId（较小 userId）/ secondId（较大 userId）',
      );
      console.log(
        '    与 [LOCK-1/2] / [LOCK-2/2] 是否严格先锁 firstId 再锁 secondId——这就是 AB-BA 不会发生的根因。',
      );
    } else {
      process.exitCode = 1;
      console.log(
        '\x1b[31m%s\x1b[0m',
        '💥 不通过：疑似有死锁，或总金额不守恒。请回看 [LOCK-*] 与 [UPDATE-*] 两条线是否有交叉反序',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exitCode = 1;
});
