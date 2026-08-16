import { Test, TestingModule } from '@nestjs/testing';
import { Logger, BadRequestException } from '@nestjs/common';
import { FinanceSettingsService } from './finance-settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SaveFinanceSettingDto } from './dto/save-finance-setting.dto';

// ---- mock PrismaService ----
const mockPrisma = {
  platformFinanceSetting: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

// ---- 工具：构造一行 DB 记录 ----
function dbRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1n,
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: '1600111122223333',
    receiverName: '测试平台佣金账户',
    receiverOpenid: null,
    mainMchId: null,
    mainAppId: null,
    updatedBy: 999040n,
    updatedAt: new Date('2026-08-15T10:00:00Z'),
    createdAt: new Date('2026-08-15T10:00:00Z'),
    ...overrides,
  };
}

// ---- 工具：构造合法 DTO ----
function validDto(overrides: Partial<SaveFinanceSettingDto> = {}): SaveFinanceSettingDto {
  return {
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: '1600111122223333',
    receiverName: '测试平台佣金账户',
    receiverOpenid: null,
    mainMchId: null,
    mainAppId: null,
    ...overrides,
  };
}

// ---- 测试日志埋点工具 ----
// 格式：[TEST-LOG] Case #序号 | 场景 | 输入: ... | 断言: ...
const testLogger = new Logger('FinanceSettingsServiceSpec');
let caseCounter = 0;
function logTest(scene: string, input: Record<string, unknown>, assertions: Record<string, unknown>) {
  caseCounter++;
  const inputStr = Object.entries(input)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(', ');
  const assertStr = Object.entries(assertions)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  testLogger.log(
    `[TEST-LOG] Case #${String(caseCounter).padStart(2, '0')} | ${scene} | 输入参数: ${inputStr} | 断言结果: ${assertStr}`,
  );
}

describe('FinanceSettingsService (财务设置)', () => {
  let service: FinanceSettingsService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceSettingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(FinanceSettingsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    caseCounter = 0;
    // 默认 env 状态：分账未通过 env 启用
    process.env.WX_PROFIT_SHARING_ENABLED = 'false';
    process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = '';
    process.env.WX_PROFIT_SHARING_RECEIVER_NAME = '';
  });

  afterAll(() => {
    delete process.env.WX_PROFIT_SHARING_ENABLED;
    delete process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID;
    delete process.env.WX_PROFIT_SHARING_RECEIVER_NAME;
  });

  // ================================================================
  // get() — 读取单例
  // ================================================================
  describe('get - 查询财务设置', () => {
    it('DB 无记录时返回 null', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      const result = await service.get();
      expect(result).toBeNull();
      logTest(
        'get() DB 无记录',
        { findUnique返回: 'null', SINGLETON_ID: '1n' },
        { 期望返回: 'null', 实际返回: result, 通过: result === null },
      );
    });

    it('DB 有记录时返回正确字段且 bigint 转为 string', async () => {
      const mockRow = dbRow();
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(mockRow);
      const result = await service.get();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('1');
      expect(result!.profitSharingEnabled).toBe(true);
      expect(result!.receiverMchId).toBe('1600111122223333');
      expect(result!.updatedBy).toBe('999040');
      logTest(
        'get() DB 有记录',
        { findUnique返回: 'dbRow(id=1n, mchId=1600111122223333, updatedBy=999040n)' },
        {
          id: `${result!.id} (期望 '1')`,
          profitSharingEnabled: `${result!.profitSharingEnabled} (期望 true)`,
          receiverMchId: `${result!.receiverMchId} (期望 '1600111122223333')`,
          updatedBy: `${result!.updatedBy} (期望 '999040', bigint→string)`,
          通过: result!.id === '1' && result!.profitSharingEnabled === true,
        },
      );
    });
  });

  // ================================================================
  // save() — upsert + 审计日志
  // ================================================================
  describe('save - 保存财务设置', () => {
    it('DB 无记录时执行 create（source=created）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      mockPrisma.platformFinanceSetting.create.mockResolvedValue(dbRow());
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = validDto();
      const result = await service.save(dto, '999040', '127.0.0.1');

      expect(result.source).toBe('created');
      expect(mockPrisma.platformFinanceSetting.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.platformFinanceSetting.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'FINANCE_SETTING_CREATE',
            targetType: 'PlatformFinanceSetting',
          }),
        }),
      );
      logTest(
        'save() DB 无记录 → create',
        { dto: { receiverType: dto.receiverType, mchId: dto.receiverMchId }, bossId: '999040', ip: '127.0.0.1' },
        {
          source: `${result.source} (期望 'created')`,
          create调用次数: mockPrisma.platformFinanceSetting.create.mock.calls.length,
          update调用次数: mockPrisma.platformFinanceSetting.update.mock.calls.length,
          审计action: 'FINANCE_SETTING_CREATE',
          通过: result.source === 'created',
        },
      );
    });

    it('DB 有记录时执行 update（source=updated）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(dbRow());
      mockPrisma.platformFinanceSetting.update.mockResolvedValue(dbRow({ receiverName: '新名称' }));
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = validDto({ receiverName: '新名称' });
      const result = await service.save(dto, '999040');

      expect(result.source).toBe('updated');
      expect(mockPrisma.platformFinanceSetting.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.platformFinanceSetting.create).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'FINANCE_SETTING_UPDATE' }),
        }),
      );
      logTest(
        'save() DB 有记录 → update',
        { dto: { receiverName: dto.receiverName }, bossId: '999040' },
        {
          source: `${result.source} (期望 'updated')`,
          update调用次数: mockPrisma.platformFinanceSetting.update.mock.calls.length,
          create调用次数: mockPrisma.platformFinanceSetting.create.mock.calls.length,
          审计action: 'FINANCE_SETTING_UPDATE',
          通过: result.source === 'updated',
        },
      );
    });

    it('审计日志中对 receiverMchId 做脱敏处理', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      mockPrisma.platformFinanceSetting.create.mockResolvedValue(dbRow());
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = validDto({ receiverMchId: '1600111122223333' });
      await service.save(dto, '1');

      const auditCall = mockPrisma.auditLog.create.mock.calls[0][0];
      const maskedMchId = auditCall.data.detail.receiverMchId;
      expect(maskedMchId).toBe('1600***3333');
      expect(maskedMchId).not.toBe('1600111122223333');
      logTest(
        'save() 审计日志脱敏',
        { 原始mchId: dto.receiverMchId, 长度: dto.receiverMchId!.length },
        {
          脱敏后: `${maskedMchId} (期望 '1600***3333')`,
          是否泄露原文: maskedMchId === '1600111122223333',
          通过: maskedMchId === '1600***3333',
        },
      );
    });

    it('审计日志失败不影响保存结果', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      mockPrisma.platformFinanceSetting.create.mockResolvedValue(dbRow());
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB write fail'));

      const result = await service.save(validDto(), '1');
      expect(result.source).toBe('created');
      logTest(
        'save() 审计日志写入失败容错',
        { 'auditLog.create': 'mockRejectedValue(Error("DB write fail"))' },
        {
          source: `${result.source} (期望 'created', 审计失败不影响)`,
          通过: result.source === 'created',
        },
      );
    });

    it('bossId 非数字时 updatedBy 为 null（不抛异常）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      mockPrisma.platformFinanceSetting.create.mockResolvedValue(dbRow({ updatedBy: null }));
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.save(validDto(), 'not-a-number');
      expect(result).toBeDefined();
      expect(result.updatedBy).toBeNull();
      logTest(
        'save() bossId 非数字',
        { bossId: "'not-a-number'", BigInt转换预期: 'null' },
        {
          updatedBy: `${result.updatedBy} (期望 null)`,
          是否抛异常: false,
          通过: result.updatedBy === null,
        },
      );
    });
  });

  // ================================================================
  // validateCross — 交叉校验
  // ================================================================
  describe('validateCross - 交叉字段校验', () => {
    it('启用分账 + MERCHANT_ID + 空商户号 → BadRequest', async () => {
      const dto = validDto({ receiverMchId: '' });
      let threw = false;
      let errMsg = '';
      try {
        await service.save(dto, '1');
      } catch (e) {
        threw = true;
        errMsg = (e as Error).message;
        expect(e).toBeInstanceOf(BadRequestException);
      }
      logTest(
        'validateCross 启用分账 + MERCHANT_ID + 空商户号',
        { profitSharingEnabled: true, receiverType: 'MERCHANT_ID', receiverMchId: "''" },
        { 抛出: 'BadRequestException', message: errMsg, 通过: threw },
      );
    });

    it('启用分账 + MERCHANT_ID + null 商户号 → BadRequest', async () => {
      const dto = validDto({ receiverMchId: null });
      let threw = false;
      let errMsg = '';
      try {
        await service.save(dto, '1');
      } catch (e) {
        threw = true;
        errMsg = (e as Error).message;
        expect(e).toBeInstanceOf(BadRequestException);
      }
      logTest(
        'validateCross 启用分账 + MERCHANT_ID + null 商户号',
        { profitSharingEnabled: true, receiverType: 'MERCHANT_ID', receiverMchId: 'null' },
        { 抛出: 'BadRequestException', message: errMsg, 通过: threw },
      );
    });

    it('启用分账 + PERSONAL_OPENID + 空 openid → BadRequest', async () => {
      const dto = validDto({ receiverType: 'PERSONAL_OPENID', receiverOpenid: '', receiverMchId: null });
      let threw = false;
      let errMsg = '';
      try {
        await service.save(dto, '1');
      } catch (e) {
        threw = true;
        errMsg = (e as Error).message;
        expect(e).toBeInstanceOf(BadRequestException);
      }
      logTest(
        'validateCross 启用分账 + PERSONAL_OPENID + 空 openid',
        { profitSharingEnabled: true, receiverType: 'PERSONAL_OPENID', receiverOpenid: "''" },
        { 抛出: 'BadRequestException', message: errMsg, 通过: threw },
      );
    });

    it('关闭分账时允许空商户号（跳过校验）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      mockPrisma.platformFinanceSetting.create.mockResolvedValue(dbRow({ profitSharingEnabled: false }));
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = validDto({ profitSharingEnabled: false, receiverMchId: '' });
      const result = await service.save(dto, '1');
      expect(result).toBeDefined();
      logTest(
        'validateCross 关闭分账 + 空商户号 → 跳过校验',
        { profitSharingEnabled: false, receiverMchId: "''" },
        { 是否抛异常: false, 返回source: result.source, 通过: result !== undefined },
      );
    });

    it('启用分账 + MERCHANT_ID + 有商户号 → 通过', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      mockPrisma.platformFinanceSetting.create.mockResolvedValue(dbRow());
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = validDto();
      const result = await service.save(dto, '1');
      expect(result).toBeDefined();
      logTest(
        'validateCross 启用分账 + MERCHANT_ID + 有商户号 → 通过',
        { profitSharingEnabled: true, receiverType: 'MERCHANT_ID', receiverMchId: dto.receiverMchId },
        { 是否抛异常: false, source: result.source, 通过: result !== undefined },
      );
    });

    it('启用分账 + PERSONAL_OPENID + 有 openid → 通过', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      mockPrisma.platformFinanceSetting.create.mockResolvedValue(
        dbRow({ receiverType: 'PERSONAL_OPENID', receiverMchId: null, receiverOpenid: 'oABC1234567890abcdef' }),
      );
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = validDto({ receiverType: 'PERSONAL_OPENID', receiverOpenid: 'oABC1234567890abcdef', receiverMchId: null });
      const result = await service.save(dto, '1');
      expect(result).toBeDefined();
      logTest(
        'validateCross 启用分账 + PERSONAL_OPENID + 有 openid → 通过',
        { profitSharingEnabled: true, receiverType: 'PERSONAL_OPENID', receiverOpenid: dto.receiverOpenid },
        { 是否抛异常: false, source: result.source, 通过: result !== undefined },
      );
    });
  });

  // ================================================================
  // getActiveProfitSharingReceiver — 支付模块调用（DB > env）
  // ================================================================
  describe('getActiveProfitSharingReceiver - 获取生效的接收方', () => {
    it('DB 有 MERCHANT_ID 配置 → 返回 DB 值', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(dbRow());
      const r = await service.getActiveProfitSharingReceiver();
      expect(r.enabled).toBe(true);
      expect(r.mchId).toBe('1600111122223333');
      expect(r.name).toBe('测试平台佣金账户');
      logTest(
        'getActiveReceiver DB MERCHANT_ID',
        { DB: 'profitSharingEnabled=true, receiverType=MERCHANT_ID, mchId=1600111122223333' },
        { enabled: r.enabled, mchId: r.mchId, name: r.name, 来源: 'DB', 通过: r.enabled && r.mchId === '1600111122223333' },
      );
    });

    it('DB 有 PERSONAL_OPENID 配置 → 返回 openid 作为 mchId', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(
        dbRow({ receiverType: 'PERSONAL_OPENID', receiverMchId: null, receiverOpenid: 'oABC1234567890abcdef' }),
      );
      const r = await service.getActiveProfitSharingReceiver();
      expect(r.enabled).toBe(true);
      expect(r.mchId).toBe('oABC1234567890abcdef');
      logTest(
        'getActiveReceiver DB PERSONAL_OPENID',
        { DB: 'receiverType=PERSONAL_OPENID, openid=oABC1234567890abcdef' },
        { enabled: r.enabled, mchId: r.mchId, 来源: 'DB(openid)', 通过: r.mchId === 'oABC1234567890abcdef' },
      );
    });

    it('DB 有配置但 profitSharingEnabled=false → 回落 env', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(
        dbRow({ profitSharingEnabled: false }),
      );
      process.env.WX_PROFIT_SHARING_ENABLED = 'true';
      process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = '1600000000';
      process.env.WX_PROFIT_SHARING_RECEIVER_NAME = 'ENV账户';

      const r = await service.getActiveProfitSharingReceiver();
      expect(r.enabled).toBe(true);
      expect(r.mchId).toBe('1600000000');
      expect(r.name).toBe('ENV账户');
      logTest(
        'getActiveReceiver DB 关闭分账 → 回落 env',
        { DB: 'profitSharingEnabled=false', env: 'ENABLED=true, MCH_ID=1600000000' },
        { enabled: r.enabled, mchId: r.mchId, name: r.name, 来源: 'env(回落)', 通过: r.mchId === '1600000000' },
      );
    });

    it('DB 有配置但 receiverMchId 为空 → 回落 env', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(
        dbRow({ receiverMchId: null }),
      );
      process.env.WX_PROFIT_SHARING_ENABLED = 'true';
      process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = '1600000000';

      const r = await service.getActiveProfitSharingReceiver();
      expect(r.enabled).toBe(true);
      expect(r.mchId).toBe('1600000000');
      logTest(
        'getActiveReceiver DB mchId 空 → 回落 env',
        { DB: 'receiverMchId=null', env: 'MCH_ID=1600000000' },
        { enabled: r.enabled, mchId: r.mchId, 来源: 'env(回落)', 通过: r.mchId === '1600000000' },
      );
    });

    it('DB 无记录 + env 未配置 → enabled=false', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      process.env.WX_PROFIT_SHARING_ENABLED = 'false';
      process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = '';

      const r = await service.getActiveProfitSharingReceiver();
      expect(r.enabled).toBe(false);
      expect(r.mchId).toBe('');
      logTest(
        'getActiveReceiver DB 无 + env 无',
        { DB: 'null', env: 'ENABLED=false, MCH_ID=""' },
        { enabled: r.enabled, mchId: r.mchId, 来源: 'env(未配置)', 通过: r.enabled === false },
      );
    });

    it('DB 无记录 + env 已配置 → enabled=true 使用 env', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      process.env.WX_PROFIT_SHARING_ENABLED = 'true';
      process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID = '1600000000';
      process.env.WX_PROFIT_SHARING_RECEIVER_NAME = 'ENV账户';

      const r = await service.getActiveProfitSharingReceiver();
      expect(r.enabled).toBe(true);
      expect(r.mchId).toBe('1600000000');
      expect(r.name).toBe('ENV账户');
      logTest(
        'getActiveReceiver DB 无 + env 有',
        { DB: 'null', env: 'ENABLED=true, MCH_ID=1600000000, NAME=ENV账户' },
        { enabled: r.enabled, mchId: r.mchId, name: r.name, 来源: 'env', 通过: r.enabled && r.mchId === '1600000000' },
      );
    });

    it('DB 有配置但 receiverName 为空 → 使用默认名称"平台佣金账户"', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(
        dbRow({ receiverName: null }),
      );
      const r = await service.getActiveProfitSharingReceiver();
      expect(r.name).toBe('平台佣金账户');
      logTest(
        'getActiveReceiver DB receiverName 空 → 默认名',
        { DB: 'receiverName=null' },
        { name: `${r.name} (期望 '平台佣金账户')`, 来源: 'DB(默认名)', 通过: r.name === '平台佣金账户' },
      );
    });
  });

  // ================================================================
  // getActiveMainMchId / getActiveAppId — DB > env 覆盖（带内存缓存）
  // ================================================================
  describe('getActiveMainMchId / getActiveAppId', () => {
    beforeEach(() => {
      // 每个用例前清空缓存，确保测试隔离
      service.clearMainConfigCache();
    });

    it('DB 未配置 + env 有值 → 返回 env.WX_MCH_ID（回落 env）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      process.env.WX_MCH_ID = '1600000001';
      const result = await service.getActiveMainMchId();
      expect(result).toBe('1600000001');
      expect(mockPrisma.platformFinanceSetting.findUnique).toHaveBeenCalledTimes(1);
      logTest(
        'getActiveMainMchId DB无配置→回落env',
        { env_WX_MCH_ID: '1600000001', DB: 'null' },
        { 返回: result, 来源: 'env(回落)', 通过: result === '1600000001' },
      );
      delete process.env.WX_MCH_ID;
    });

    it('DB 配置了 mainMchId → 返回 DB 值（覆盖 env）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(
        dbRow({ mainMchId: '1600000099' }),
      );
      process.env.WX_MCH_ID = '1600000001';
      const result = await service.getActiveMainMchId();
      expect(result).toBe('1600000099');
      logTest(
        'getActiveMainMchId DB有配置→覆盖env',
        { env_WX_MCH_ID: '1600000001', DB_mainMchId: '1600000099' },
        { 返回: result, 来源: 'DB', 通过: result === '1600000099' },
      );
      delete process.env.WX_MCH_ID;
    });

    it('DB 与 env 均未配置 → 返回空字符串', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      delete process.env.WX_MCH_ID;
      const result = await service.getActiveMainMchId();
      expect(result).toBe('');
      logTest(
        'getActiveMainMchId DB无+env无→空',
        { env_WX_MCH_ID: 'undefined', DB: 'null' },
        { 返回: `'${result}'`, 通过: result === '' },
      );
    });

    it('缓存命中时不重复查 DB（TTL 内只查一次）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(
        dbRow({ mainMchId: '1600000099' }),
      );
      // 第一次调用：会查 DB
      const r1 = await service.getActiveMainMchId();
      // 第二次调用：应命中缓存，不再查 DB
      const r2 = await service.getActiveMainMchId();
      expect(r1).toBe('1600000099');
      expect(r2).toBe('1600000099');
      expect(mockPrisma.platformFinanceSetting.findUnique).toHaveBeenCalledTimes(1);
      logTest(
        'getActiveMainMchId 缓存命中',
        { 第一次返回: r1, 第二次返回: r2, DB查询次数: mockPrisma.platformFinanceSetting.findUnique.mock.calls.length },
        { 缓存生效: mockPrisma.platformFinanceSetting.findUnique.mock.calls.length === 1, 通过: r1 === r2 && mockPrisma.platformFinanceSetting.findUnique.mock.calls.length === 1 },
      );
    });

    it('DB 查询失败 → 降级返回 env（不抛异常）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockRejectedValue(new Error('DB connection lost'));
      process.env.WX_MCH_ID = '1600000001';
      const result = await service.getActiveMainMchId();
      expect(result).toBe('1600000001');
      logTest(
        'getActiveMainMchId DB查询失败→降级env',
        { env_WX_MCH_ID: '1600000001', DB抛出: 'Error("DB connection lost")' },
        { 返回: result, 是否抛异常: false, 通过: result === '1600000001' },
      );
      delete process.env.WX_MCH_ID;
    });

    it('save() 后缓存被清空，下次读取拿到新值', async () => {
      // 第一次：DB 有 mainMchId=1600000099
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValueOnce(
        dbRow({ mainMchId: '1600000099' }),
      );
      const r1 = await service.getActiveMainMchId();
      expect(r1).toBe('1600000099');

      // 模拟 save() 后清空缓存：调用 save，再 mock 一个新值
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValueOnce(dbRow());
      mockPrisma.platformFinanceSetting.update.mockResolvedValue(dbRow({ mainMchId: '1600000088' }));
      mockPrisma.auditLog.create.mockResolvedValue({});
      await service.save(validDto({ mainMchId: '1600000088' }), '1');

      // save 后再次读取：应查 DB 拿到新值 1600000088
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValueOnce(
        dbRow({ mainMchId: '1600000088' }),
      );
      const r2 = await service.getActiveMainMchId();
      expect(r2).toBe('1600000088');
      logTest(
        'save() 后缓存清空',
        { save前值: r1, save后值: r2 },
        { 缓存已清空: r1 !== r2, 通过: r2 === '1600000088' },
      );
    });

    it('getActiveAppId 返回 env.WX_APP_ID（DB 未配置时回落）', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      process.env.WX_APP_ID = 'wx1234567890abcdef';
      const result = await service.getActiveAppId();
      expect(result).toBe('wx1234567890abcdef');
      logTest(
        'getActiveAppId DB无配置→回落env',
        { env_WX_APP_ID: 'wx1234567890abcdef', DB: 'null' },
        { 返回: result, 来源: 'env(回落)', 通过: result === 'wx1234567890abcdef' },
      );
      delete process.env.WX_APP_ID;
    });

    it('getActiveAppId DB 配置了 mainAppId → 返回 DB 值', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(
        dbRow({ mainAppId: 'wxabcdef1234567890' }),
      );
      const result = await service.getActiveAppId();
      expect(result).toBe('wxabcdef1234567890');
      logTest(
        'getActiveAppId DB有配置→覆盖env',
        { DB_mainAppId: 'wxabcdef1234567890' },
        { 返回: result, 来源: 'DB', 通过: result === 'wxabcdef1234567890' },
      );
    });

    it('getActiveAppId 在 env 与 DB 均未配置时返回空字符串', async () => {
      mockPrisma.platformFinanceSetting.findUnique.mockResolvedValue(null);
      delete process.env.WX_APP_ID;
      const result = await service.getActiveAppId();
      expect(result).toBe('');
      logTest(
        'getActiveAppId DB无+env无→空',
        { env_WX_APP_ID: 'undefined', DB: 'null' },
        { 返回: `'${result}'`, 通过: result === '' },
      );
    });

    it('clearMainConfigCache() 可手动清空缓存', () => {
      // 不抛异常即可
      expect(() => service.clearMainConfigCache()).not.toThrow();
      logTest(
        'clearMainConfigCache 手动清空',
        {},
        { 未抛异常: true, 通过: true },
      );
    });
  });
});
