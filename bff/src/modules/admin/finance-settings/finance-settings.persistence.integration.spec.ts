/**
 * FinanceSettingsService 数据库持久化集成测试
 *
 * 验证点：
 *   1) 单例写入：id=1 固定主键，不会产生多行
 *   2) 首次 create / 后续 update 流程字段持久化正确
 *   3) updatedBy 正确记录操作人
 *   4) MERCHANT_ID / PERSONAL_OPENID 两种接收方类型的字段 Round-Trip 一致
 *   5) mainMchId / mainAppId DB 覆盖优先级（getActiveMainMchId / getActiveAppId 返回 DB 值）
 *   6) 审计日志落库（动作、targetType、脱敏字段）
 *
 * 运行：npm run test:e2e  (需要真实 MySQL，表已通过 prisma migrate 创建)
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { FinanceSettingsService } from './finance-settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SaveFinanceSettingDto } from './dto/save-finance-setting.dto';

// ---- 基础设施 ----
const SINGLETON_ID = 1n;
const INTEGRATION_TAG = 'finance_setting_integration_test';
const testLogger = new Logger('FS-Persistence-Spec');

// ---- 合法 DTO 构造 ----
function merchantDto(overrides: Partial<SaveFinanceSettingDto> = {}): SaveFinanceSettingDto {
  return {
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: '1600999988887777',
    receiverName: '集成测试-平台佣金账户(商户)',
    receiverOpenid: null,
    mainMchId: '1600000011112222',
    mainAppId: 'wxaaaaaaaaaaaaaaaa',
    ...overrides,
  };
}

function personalDto(overrides: Partial<SaveFinanceSettingDto> = {}): SaveFinanceSettingDto {
  return {
    profitSharingEnabled: true,
    receiverType: 'PERSONAL_OPENID',
    receiverMchId: null,
    receiverName: '集成测试-平台佣金账户(个人)',
    receiverOpenid: 'oABCKKKK111122223333',
    mainMchId: '1600000011112222',
    mainAppId: 'wxbbbbbbbbbbbbbbbbbb',
    ...overrides,
  };
}

// ---- 用例日志埋点 ----
let caseNo = 0;
function logCase(
  scene: string,
  input: Record<string, unknown>,
  assertions: Record<string, unknown>,
) {
  caseNo++;
  const inputStr = Object.entries(input)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(', ');
  const assertStr = Object.entries(assertions)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(', ');
  testLogger.log(
    `[DB-PERSIST] Case #${String(caseNo).padStart(2, '0')} | 场景=${scene} | 输入: ${inputStr} | 断言: ${assertStr}`,
  );
}

describe('FinanceSettingsService DB 持久化集成测试', () => {
  let prisma: PrismaClient;
  let prismaService: PrismaService;
  let service: FinanceSettingsService;
  let testBossId: bigint; // 测试用 BOSS 账号，写入审计日志

  beforeAll(async () => {
    prisma = new PrismaClient();
    prismaService = prisma as unknown as PrismaService;
    service = new FinanceSettingsService(prismaService);

    // 创建一个 BOSS 用户（用于 updatedBy + 审计日志 adminId 校验）
    const boss = await prisma.user.create({
      data: {
        openid: `${INTEGRATION_TAG}_BOSS_${Date.now()}`,
        nickname: '持久化测试-BOSS',
        creditScore: 100,
        role: 'BOSS',
        status: 'ACTIVE',
      },
    });
    testBossId = boss.id;
    testLogger.log(`[DB-PERSIST] 初始化完成：BOSS 用户 id=${boss.id}`);
  }, 30000);

  afterAll(async () => {
    // 清理：本测试写入的 platform_finance_setting、audit_log、user
    await prisma.auditLog.deleteMany({
      where: { targetType: 'PlatformFinanceSetting', targetId: SINGLETON_ID },
    });
    await prisma.platformFinanceSetting.deleteMany({ where: { id: SINGLETON_ID } });
    await prisma.user.deleteMany({ where: { openid: { startsWith: INTEGRATION_TAG } } });
    await prisma.$disconnect();
    testLogger.log(`[DB-PERSIST] 清理完成，DB 连接已断开`);
  }, 30000);

  beforeEach(async () => {
    // 每个用例前：清空配置表与相关审计日志
    await prisma.auditLog.deleteMany({
      where: { targetType: 'PlatformFinanceSetting', targetId: SINGLETON_ID },
    });
    await prisma.platformFinanceSetting.deleteMany({ where: { id: SINGLETON_ID } });
    service.clearMainConfigCache();
  });

  // ================================================================
  // 1. 单例约束：只允许 id=1 一行
  // ================================================================
  describe('1. 单例写入约束 (SINGLETON_ID=1)', () => {
    it('首次 create 写入的主键 id 必须是 1n', async () => {
      const dto = merchantDto();
      const saved = await service.save(dto, testBossId.toString(), '127.0.0.1');
      expect(saved.id).toBe('1');
      expect(saved.source).toBe('created');

      const row = await prisma.platformFinanceSetting.findUnique({ where: { id: SINGLETON_ID } });
      expect(row).not.toBeNull();
      expect(row!.id).toBe(SINGLETON_ID);

      const rowCount = await prisma.platformFinanceSetting.count();
      expect(rowCount).toBe(1);

      logCase(
        'create 后 ID=1n 且行数=1',
        { 写入方式: 'create', 行数: 1 },
        { 期望id: '1', 实际id: saved.id, DB行数: rowCount, 通过: saved.id === '1' && rowCount === 1 },
      );
    });

    it('第二次 save 走 update，行数仍为 1（不会新增）', async () => {
      await service.save(merchantDto(), testBossId.toString());
      const updated = await service.save(
        merchantDto({ receiverName: '覆盖后的名称' }),
        testBossId.toString(),
      );
      expect(updated.source).toBe('updated');
      const rowCount = await prisma.platformFinanceSetting.count();
      expect(rowCount).toBe(1);
      logCase(
        'update 后行数仍=1',
        { save次数: 2 },
        { source: updated.source, DB行数: rowCount, 通过: updated.source === 'updated' && rowCount === 1 },
      );
    });
  });

  // ================================================================
  // 2. MERCHANT_ID 场景：字段 Round-Trip 一致性
  // ================================================================
  describe('2. MERCHANT_ID 场景 字段 Round-Trip', () => {
    it('保存 MERCHANT_ID 配置后，get() 每个字段与输入一致', async () => {
      const dto = merchantDto({
        profitSharingEnabled: true,
        receiverType: 'MERCHANT_ID',
        receiverMchId: '1600AAAAAAAAAAAA',
        receiverName: 'RoundTrip-商戶名稱測試_中文',
        mainMchId: '1600MMMMMMMMMMMM',
        mainAppId: 'wxMMMMMMMMMMMMMM',
      });
      const saved = await service.save(dto, testBossId.toString(), '10.0.0.1');

      // 1) save 返回值检查
      expect(saved.source).toBe('created');
      expect(saved.profitSharingEnabled).toBe(true);
      expect(saved.receiverType).toBe('MERCHANT_ID');
      expect(saved.receiverMchId).toBe('1600AAAAAAAAAAAA');
      expect(saved.receiverName).toBe('RoundTrip-商戶名稱測試_中文');
      expect(saved.receiverOpenid).toBeNull();
      expect(saved.mainMchId).toBe('1600MMMMMMMMMMMM');
      expect(saved.mainAppId).toBe('wxMMMMMMMMMMMMMM');
      expect(saved.updatedBy).toBe(testBossId.toString());

      // 2) 从 service.get() 再读一次
      const read = await service.get();
      expect(read).not.toBeNull();
      expect(read!.profitSharingEnabled).toBe(dto.profitSharingEnabled);
      expect(read!.receiverType).toBe(dto.receiverType);
      expect(read!.receiverMchId).toBe(dto.receiverMchId);
      expect(read!.receiverName).toBe(dto.receiverName);
      expect(read!.receiverOpenid).toBe(dto.receiverOpenid);
      expect(read!.mainMchId).toBe(dto.mainMchId);
      expect(read!.mainAppId).toBe(dto.mainAppId);
      expect(read!.updatedBy).toBe(testBossId.toString());

      // 3) 直接读 DB 原生行再核对
      const raw = await prisma.platformFinanceSetting.findUnique({ where: { id: SINGLETON_ID } });
      expect(raw).not.toBeNull();
      expect(raw!.profitSharingEnabled).toBe(true);
      expect(raw!.receiverMchId).toBe('1600AAAAAAAAAAAA');
      expect(raw!.mainMchId).toBe('1600MMMMMMMMMMMM');
      expect(raw!.updatedBy).toBe(testBossId); // bigint 对比

      logCase(
        'MERCHANT_ID Round-Trip',
        {
          dto_receiverMchId: dto.receiverMchId,
          dto_mainMchId: dto.mainMchId,
          dto_mainAppId: dto.mainAppId,
        },
        {
          'save返回.receiverMchId': saved.receiverMchId,
          'service.get返回.receiverMchId': read!.receiverMchId,
          'DB原生.receiverMchId': raw!.receiverMchId,
          updatedBy_DB类型: `${typeof raw!.updatedBy} => ${raw!.updatedBy}`,
          三端一致:
            saved.receiverMchId === read!.receiverMchId &&
            read!.receiverMchId === raw!.receiverMchId,
          通过:
            saved.receiverMchId === '1600AAAAAAAAAAAA' &&
            read!.mainMchId === '1600MMMMMMMMMMMM' &&
            read!.mainAppId === 'wxMMMMMMMMMMMMMM' &&
            raw!.updatedBy === testBossId,
        },
      );
    });
  });

  // ================================================================
  // 3. PERSONAL_OPENID 场景：字段 Round-Trip 一致性
  // ================================================================
  describe('3. PERSONAL_OPENID 场景 字段 Round-Trip', () => {
    it('PERSONAL_OPENID 配置：receiverOpenid 持久化正确，receiverMchId 为 null', async () => {
      const dto = personalDto();
      const saved = await service.save(dto, testBossId.toString());

      expect(saved.receiverType).toBe('PERSONAL_OPENID');
      expect(saved.receiverOpenid).toBe('oABCKKKK111122223333');
      expect(saved.receiverMchId).toBeNull();

      const read = await service.get();
      expect(read!.receiverType).toBe('PERSONAL_OPENID');
      expect(read!.receiverOpenid).toBe('oABCKKKK111122223333');
      expect(read!.receiverMchId).toBeNull();

      const raw = await prisma.platformFinanceSetting.findUnique({ where: { id: SINGLETON_ID } });
      expect(raw!.receiverOpenid).toBe('oABCKKKK111122223333');
      expect(raw!.receiverMchId).toBeNull();

      logCase(
        'PERSONAL_OPENID Round-Trip',
        {
          dto_receiverOpenid: dto.receiverOpenid,
          dto_receiverMchId: dto.receiverMchId,
        },
        {
          read_receiverOpenid: read!.receiverOpenid,
          read_receiverMchId: String(read!.receiverMchId),
          DB_receiverOpenid: raw!.receiverOpenid,
          DB_receiverMchId: String(raw!.receiverMchId),
          通过: raw!.receiverOpenid === 'oABCKKKK111122223333' && raw!.receiverMchId === null,
        },
      );
    });
  });

  // ================================================================
  // 4. updatedBy 字段记录
  // ================================================================
  describe('4. updatedBy 操作人记录', () => {
    it('save 传入合法 bossId → DB updatedBy 为对应 bigint', async () => {
      const bossIdStr = testBossId.toString();
      const saved = await service.save(merchantDto(), bossIdStr);
      expect(saved.updatedBy).toBe(bossIdStr);

      const raw = await prisma.platformFinanceSetting.findUnique({ where: { id: SINGLETON_ID } });
      expect(raw!.updatedBy).toBe(testBossId);

      logCase(
        'updatedBy 合法 bossId',
        { bossIdStr, DB_type: 'bigint' },
        { service返回updatedBy: saved.updatedBy, DB_updatedBy: raw!.updatedBy, 通过: raw!.updatedBy === testBossId },
      );
    });

    it('save 传入非数字 bossId（如 UUID）→ DB updatedBy 为 null，不抛异常', async () => {
      const saved = await service.save(merchantDto(), 'not-a-valid-bigint');
      expect(saved.updatedBy).toBeNull();

      const raw = await prisma.platformFinanceSetting.findUnique({ where: { id: SINGLETON_ID } });
      expect(raw!.updatedBy).toBeNull();

      logCase(
        'updatedBy 非数字→null',
        { bossId: "'not-a-valid-bigint'" },
        { service返回updatedBy: String(saved.updatedBy), DB_updatedBy: String(raw!.updatedBy), 通过: raw!.updatedBy === null },
      );
    });
  });

  // ================================================================
  // 5. 覆盖更新：再次 save 会覆盖原有列的值
  // ================================================================
  describe('5. 覆盖更新：update 后新值正确生效', () => {
    it('MERCHANT_ID → 切换 PERSONAL_OPENID：旧 receiverMchId 被置 null，新 receiverOpenid 写入', async () => {
      // Step 1: 写 MERCHANT_ID
      await service.save(merchantDto(), testBossId.toString());
      const before = await prisma.platformFinanceSetting.findUnique({ where: { id: SINGLETON_ID } });
      expect(before!.receiverType).toBe('MERCHANT_ID');
      expect(before!.receiverMchId).toBe('1600999988887777');
      expect(before!.receiverOpenid).toBeNull();

      // Step 2: 切 PERSONAL_OPENID
      const saved = await service.save(personalDto(), testBossId.toString());
      expect(saved.source).toBe('updated');

      const after = await prisma.platformFinanceSetting.findUnique({ where: { id: SINGLETON_ID } });
      expect(after!.receiverType).toBe('PERSONAL_OPENID');
      expect(after!.receiverMchId).toBeNull(); // 旧值应被清为 null
      expect(after!.receiverOpenid).toBe('oABCKKKK111122223333');

      logCase(
        '类型切换覆盖更新',
        {
          切换前receiverType: before!.receiverType,
          切换后receiverType: after!.receiverType,
        },
        {
          切换后receiverMchId: String(after!.receiverMchId),
          切换后receiverOpenid: after!.receiverOpenid,
          通过: after!.receiverMchId === null && after!.receiverOpenid === 'oABCKKKK111122223333',
        },
      );
    });

    it('profitSharingEnabled 切换：true → false → true，DB 值与返回值均同步', async () => {
      await service.save(merchantDto({ profitSharingEnabled: true }), testBossId.toString());
      let r = await service.get();
      expect(r!.profitSharingEnabled).toBe(true);

      await service.save(merchantDto({ profitSharingEnabled: false }), testBossId.toString());
      r = await service.get();
      expect(r!.profitSharingEnabled).toBe(false);

      await service.save(merchantDto({ profitSharingEnabled: true }), testBossId.toString());
      r = await service.get();
      expect(r!.profitSharingEnabled).toBe(true);

      logCase(
        'profitSharingEnabled 切换',
        { save次数: 3, 顺序: 'true→false→true' },
        { 最终值: r!.profitSharingEnabled, 通过: r!.profitSharingEnabled === true },
      );
    });

    it('mainMchId / mainAppId 更新后，缓存被清空并返回新值（DB 覆盖 env）', async () => {
      // Step 1: 写入 mainMchId=1600OLDOLDOLDOLD / mainAppId=wxOLDOLDOLDOLDOLD
      process.env.WX_MCH_ID = '1600ENVFAKEMCH00';
      process.env.WX_APP_ID = 'wxENVFAKEAPP0000';
      await service.save(
        merchantDto({ mainMchId: '1600OLDOLDOLDOLD', mainAppId: 'wxOLDOLDOLDOLDOLD' }),
        testBossId.toString(),
      );
      service.clearMainConfigCache();

      const mch1 = await service.getActiveMainMchId();
      const app1 = await service.getActiveAppId();
      expect(mch1).toBe('1600OLDOLDOLDOLD');
      expect(app1).toBe('wxOLDOLDOLDOLDOLD');

      // Step 2: 更新成新值，save 会自动清空缓存
      await service.save(
        merchantDto({ mainMchId: '1600NEWNEWNEWNEW', mainAppId: 'wxNEWNEWNEWNEWNEW' }),
        testBossId.toString(),
      );
      const mch2 = await service.getActiveMainMchId();
      const app2 = await service.getActiveAppId();
      expect(mch2).toBe('1600NEWNEWNEWNEW');
      expect(app2).toBe('wxNEWNEWNEWNEWNEW');

      delete process.env.WX_MCH_ID;
      delete process.env.WX_APP_ID;

      logCase(
        '覆盖更新 + 缓存清空',
        { 旧mainMchId: '1600OLDOLDOLDOLD', 新mainMchId: '1600NEWNEWNEWNEW' },
        {
          更新前返回: mch1,
          更新后返回: mch2,
          DB覆盖env_WX_MCH_ID: process.env.WX_MCH_ID
            ? `仍存在=${process.env.WX_MCH_ID}`
            : '已清理',
          通过: mch1 === '1600OLDOLDOLDOLD' && mch2 === '1600NEWNEWNEWNEW',
        },
      );
    });
  });

  // ================================================================
  // 6. 审计日志落库
  // ================================================================
  describe('6. 审计日志落库', () => {
    it('首次 create → auditLog.action = FINANCE_SETTING_CREATE，receiverMchId 脱敏', async () => {
      const dto = merchantDto({ receiverMchId: '1600FFFFEEEEFFFF' });
      await service.save(dto, testBossId.toString(), '192.168.1.100');

      const audit = await prisma.auditLog.findFirst({
        where: { targetType: 'PlatformFinanceSetting', targetId: SINGLETON_ID },
        orderBy: { id: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.action).toBe('FINANCE_SETTING_CREATE');
      expect(audit!.adminId).toBe(testBossId);
      expect(audit!.ip).toBe('192.168.1.100');

      const detail = audit!.detail as Record<string, unknown>;
      // 敏感字段必须脱敏（不是原文）
      expect(detail.receiverMchId).not.toBe('1600FFFFEEEEFFFF');
      expect(detail.receiverMchId).toBe('1600***FFFF');
      expect(detail.profitSharingEnabled).toBe(true);

      logCase(
        '审计日志 create + 脱敏',
        { action: audit!.action, 原始mchId: dto.receiverMchId },
        {
          audit_adminId: audit!.adminId,
          audit_ip: audit!.ip,
          audit_mchId脱敏: detail.receiverMchId,
          未泄露原文: detail.receiverMchId !== dto.receiverMchId,
          通过:
            audit!.action === 'FINANCE_SETTING_CREATE' &&
            detail.receiverMchId === '1600***FFFF',
        },
      );
    });

    it('再次 update → auditLog.action = FINANCE_SETTING_UPDATE', async () => {
      await service.save(merchantDto(), testBossId.toString());
      await service.save(merchantDto({ receiverName: '已更新' }), testBossId.toString(), '192.168.1.101');

      const audits = await prisma.auditLog.findMany({
        where: { targetType: 'PlatformFinanceSetting', targetId: SINGLETON_ID },
        orderBy: { id: 'asc' },
      });
      expect(audits.length).toBeGreaterThanOrEqual(2);
      const last = audits[audits.length - 1];
      expect(last.action).toBe('FINANCE_SETTING_UPDATE');
      expect(last.ip).toBe('192.168.1.101');

      logCase(
        '审计日志 update',
        { 审计记录数: audits.length },
        { 最后一条action: last.action, ip: last.ip, 通过: last.action === 'FINANCE_SETTING_UPDATE' },
      );
    });
  });

  // ================================================================
  // 7. 清理 / 空值 场景
  // ================================================================
  describe('7. 清理与空值场景', () => {
    it('删除配置后 get() 返回 null', async () => {
      await service.save(merchantDto(), testBossId.toString());
      const before = await service.get();
      expect(before).not.toBeNull();

      await prisma.platformFinanceSetting.deleteMany({ where: { id: SINGLETON_ID } });
      const after = await service.get();
      expect(after).toBeNull();

      logCase(
        '删除后 get() = null',
        { 删除前: before ? '有记录' : 'null' },
        { 删除后: after === null ? 'null' : '有残留', 通过: after === null },
      );
    });

    it('关闭分账场景下保存：profitSharingEnabled=false 持久化正确，后续 getActiveReceiver 回落 env', async () => {
      await service.save(
        merchantDto({ profitSharingEnabled: false, receiverMchId: null }),
        testBossId.toString(),
      );
      const read = await service.get();
      expect(read!.profitSharingEnabled).toBe(false);
      expect(read!.receiverMchId).toBeNull();

      // 回落 env 验证
      process.env.WX_PROFIT_SHARING_ENABLED = 'true';
      process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = '1600ENV11112222';
      service.clearMainConfigCache();
      const r = await service.getActiveProfitSharingReceiver();
      expect(r.enabled).toBe(true);
      expect(r.mchId).toBe('1600ENV11112222');
      delete process.env.WX_PROFIT_SHARING_ENABLED;
      delete process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID;

      logCase(
        '关闭分账 → getActiveReceiver 回落 env',
        {
          DB_profitSharingEnabled: read!.profitSharingEnabled,
          env_RECEIVER_MCH_ID: '1600ENV11112222',
        },
        {
          getActiveReceiver_enabled: r.enabled,
          getActiveReceiver_mchId: r.mchId,
          通过: r.enabled && r.mchId === '1600ENV11112222',
        },
      );
    });
  });
});
