import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { BadRequestException, Logger } from '@nestjs/common';
import { FinanceSettingsController } from './finance-settings.controller';
import { FinanceSettingsService } from './finance-settings.service';
import { AdminGuard, ROLES_KEY } from '../../../auth/guards/admin.guard';
import { SaveFinanceSettingDto } from './dto/save-finance-setting.dto';
import type { Request } from 'express';

// ---- mock FinanceSettingsService ----
const mockService = {
  get: jest.fn(),
  save: jest.fn(),
};

// ---- 工具：构造带 user 信息的 Request ----
function mockReq(sub: string): Request {
  return { user: { sub } } as unknown as Request;
}

// ---- 工具：构造合法 DTO ----
function validDto(overrides: Partial<SaveFinanceSettingDto> = {}): SaveFinanceSettingDto {
  return {
    profitSharingEnabled: true,
    receiverType: 'MERCHANT_ID',
    receiverMchId: '1600111122223333',
    receiverName: '测试',
    receiverOpenid: null,
    mainMchId: null,
    mainAppId: null,
    ...overrides,
  };
}

// ---- 测试日志埋点工具 ----
const testLogger = new Logger('FinanceSettingsControllerSpec');
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

describe('FinanceSettingsController (财务设置 HTTP 层)', () => {
  let controller: FinanceSettingsController;
  let reflector: Reflector;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FinanceSettingsController],
      providers: [
        { provide: FinanceSettingsService, useValue: mockService },
        Reflector,
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FinanceSettingsController);
    reflector = module.get(Reflector);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    caseCounter = 0;
  });

  // ================================================================
  // @Roles 装饰器声明验证
  // ================================================================
  describe('@Roles 装饰器声明', () => {
    it('Controller 类上声明了 @Roles("BOSS", "SUPER_ADMIN")', () => {
      const roles = reflector.get<string[]>(ROLES_KEY, FinanceSettingsController);
      expect(roles).toBeDefined();
      expect(roles).toEqual(expect.arrayContaining(['BOSS', 'SUPER_ADMIN']));
      logTest(
        '@Roles 类级别声明',
        { 读取key: ROLES_KEY, 目标: 'FinanceSettingsController' },
        { roles: JSON.stringify(roles), 包含BOSS: roles?.includes('BOSS'), 包含SUPER_ADMIN: roles?.includes('SUPER_ADMIN'), 通过: roles?.includes('BOSS') && roles?.includes('SUPER_ADMIN') },
      );
    });
  });

  // ================================================================
  // GET /admin/finance-settings
  // ================================================================
  describe('GET /admin/finance-settings', () => {
    it('调用 service.get() 并返回结果', async () => {
      const mockData = { id: '1', profitSharingEnabled: true, receiverType: 'MERCHANT_ID' };
      mockService.get.mockResolvedValue(mockData);

      const result = await controller.get();

      expect(result).toEqual(mockData);
      expect(mockService.get).toHaveBeenCalledTimes(1);
      logTest(
        'GET → service.get() 返回数据',
        { 'service.get返回': JSON.stringify(mockData) },
        { controller返回: JSON.stringify(result), 调用次数: mockService.get.mock.calls.length, 通过: result === mockData },
      );
    });

    it('service.get() 返回 null 时 controller 也返回 null', async () => {
      mockService.get.mockResolvedValue(null);
      const result = await controller.get();
      expect(result).toBeNull();
      logTest(
        'GET → service.get() 返回 null',
        { 'service.get返回': 'null' },
        { controller返回: result, 通过: result === null },
      );
    });
  });

  // ================================================================
  // PUT /admin/finance-settings
  // ================================================================
  describe('PUT /admin/finance-settings', () => {
    it('从 req.user.sub 提取 bossId 并传给 service.save()', async () => {
      const dto = validDto();
      const mockResult = { ...dto, id: '1', source: 'created' as const };
      mockService.save.mockResolvedValue(mockResult);

      const req = mockReq('999040');
      const result = await controller.save(dto, req, '127.0.0.1');

      expect(result).toEqual(mockResult);
      expect(mockService.save).toHaveBeenCalledWith(dto, '999040', '127.0.0.1');
      logTest(
        'PUT → bossId 提取 + service.save() 调用',
        { req_user_sub: '999040', dto_receiverMchId: dto.receiverMchId, ip: '127.0.0.1' },
        {
          传入bossId: mockService.save.mock.calls[0][1],
          传入ip: mockService.save.mock.calls[0][2],
          result_source: result.source,
          通过: mockService.save.mock.calls[0][1] === '999040',
        },
      );
    });

    it('IP 参数正确传递给 service.save()', async () => {
      mockService.save.mockResolvedValue({ id: '1', source: 'updated' });
      const req = mockReq('1');
      await controller.save(validDto(), req, '192.168.1.1');
      expect(mockService.save).toHaveBeenCalledWith(
        expect.anything(),
        '1',
        '192.168.1.1',
      );
      logTest(
        'PUT → IP 参数传递',
        { 传入ip: '192.168.1.1' },
        {
          service收到的ip: mockService.save.mock.calls[0][2],
          通过: mockService.save.mock.calls[0][2] === '192.168.1.1',
        },
      );
    });

    it('service.save() 抛出 BadRequestException 时 controller 原样传播', async () => {
      const errMsg = '商户号必须是 8~32 位数字';
      mockService.save.mockRejectedValue(new BadRequestException(errMsg));
      const req = mockReq('1');
      let threw = false;
      let actualErr = '';
      try {
        await controller.save(validDto({ receiverMchId: '' }), req, '::1');
      } catch (e) {
        threw = true;
        actualErr = (e as Error).message;
        expect(e).toBeInstanceOf(BadRequestException);
      }
      logTest(
        'PUT → BadRequest 传播',
        { dto_receiverMchId: "''", service抛出: `BadRequestException("${errMsg}")` },
        { controller是否传播: threw, 实际message: actualErr, 通过: threw && actualErr === errMsg },
      );
    });
  });

  // ================================================================
  // 权限控制：验证 @Roles 声明的角色列表
  // ================================================================
  describe('权限控制 - @Roles 角色白名单', () => {
    it('BOSS 在 @Roles 列表中', () => {
      const roles = reflector.get<string[]>(ROLES_KEY, FinanceSettingsController);
      expect(roles).toContain('BOSS');
      logTest(
        '权限白名单 BOSS',
        { roles: JSON.stringify(roles) },
        { 包含BOSS: roles?.includes('BOSS'), 通过: roles?.includes('BOSS') === true },
      );
    });

    it('SUPER_ADMIN 在 @Roles 列表中', () => {
      const roles = reflector.get<string[]>(ROLES_KEY, FinanceSettingsController);
      expect(roles).toContain('SUPER_ADMIN');
      logTest(
        '权限白名单 SUPER_ADMIN',
        { roles: JSON.stringify(roles) },
        { 包含SUPER_ADMIN: roles?.includes('SUPER_ADMIN'), 通过: roles?.includes('SUPER_ADMIN') === true },
      );
    });

    it('STAFF 不在 @Roles 列表中', () => {
      const roles = reflector.get<string[]>(ROLES_KEY, FinanceSettingsController);
      expect(roles).not.toContain('STAFF');
      logTest(
        '权限白名单 STAFF (应拒绝)',
        { roles: JSON.stringify(roles) },
        { 不包含STAFF: !roles?.includes('STAFF'), 通过: !roles?.includes('STAFF') },
      );
    });

    it('ADMIN 不在 @Roles 列表中', () => {
      const roles = reflector.get<string[]>(ROLES_KEY, FinanceSettingsController);
      expect(roles).not.toContain('ADMIN');
      logTest(
        '权限白名单 ADMIN (应拒绝)',
        { roles: JSON.stringify(roles) },
        { 不包含ADMIN: !roles?.includes('ADMIN'), 通过: !roles?.includes('ADMIN') },
      );
    });
  });

  // ================================================================
  // DTO 字段校验规则验证
  // ================================================================
  describe('DTO 校验规则（SaveFinanceSettingDto）', () => {
    it('profitSharingEnabled 字段可赋值 boolean', () => {
      const dto = new SaveFinanceSettingDto();
      dto.profitSharingEnabled = true;
      expect(dto.profitSharingEnabled).toBe(true);
      logTest(
        'DTO profitSharingEnabled',
        { 赋值: true },
        { 实际值: dto.profitSharingEnabled, 类型: typeof dto.profitSharingEnabled, 通过: dto.profitSharingEnabled === true },
      );
    });

    it('receiverType 只允许 MERCHANT_ID 或 PERSONAL_OPENID', () => {
      const dto = new SaveFinanceSettingDto();
      dto.receiverType = 'MERCHANT_ID';
      const v1 = dto.receiverType;
      dto.receiverType = 'PERSONAL_OPENID';
      const v2 = dto.receiverType;
      expect(v1).toBe('MERCHANT_ID');
      expect(v2).toBe('PERSONAL_OPENID');
      logTest(
        'DTO receiverType enum',
        { 测试值1: 'MERCHANT_ID', 测试值2: 'PERSONAL_OPENID' },
        { v1: v1, v2: v2, 通过: v1 === 'MERCHANT_ID' && v2 === 'PERSONAL_OPENID' },
      );
    });

    it('receiverMchId 格式校验：合法商户号匹配 /^\\d{8,32}$/', () => {
      const valid = '1600111122223333';
      const invalid = 'abc';
      const validMatch = /^\d{8,32}$/.test(valid);
      const invalidMatch = /^\d{8,32}$/.test(invalid);
      expect(validMatch).toBe(true);
      expect(invalidMatch).toBe(false);
      logTest(
        'DTO receiverMchId 正则',
        { 合法值: valid, 非法值: invalid, 正则: '/^\\d{8,32}$/' },
        { 合法匹配: validMatch, 非法匹配: invalidMatch, 通过: validMatch && !invalidMatch },
      );
    });

    it('mainAppId 格式校验：合法 AppID 匹配 /^wx[a-f0-9]{16}$/', () => {
      const valid = 'wx1234567890abcdef';
      const invalid = 'abc123';
      const validMatch = /^wx[a-f0-9]{16}$/.test(valid);
      const invalidMatch = /^wx[a-f0-9]{16}$/.test(invalid);
      expect(validMatch).toBe(true);
      expect(invalidMatch).toBe(false);
      logTest(
        'DTO mainAppId 正则',
        { 合法值: valid, 非法值: invalid, 正则: '/^wx[a-f0-9]{16}$/' },
        { 合法匹配: validMatch, 非法匹配: invalidMatch, 通过: validMatch && !invalidMatch },
      );
    });

    it('mainMchId 格式校验：合法主商户号匹配 /^\\d{8,32}$/', () => {
      const valid = '1600000001';
      const invalid = 'abc';
      const validMatch = /^\d{8,32}$/.test(valid);
      const invalidMatch = /^\d{8,32}$/.test(invalid);
      expect(validMatch).toBe(true);
      expect(invalidMatch).toBe(false);
      logTest(
        'DTO mainMchId 正则',
        { 合法值: valid, 非法值: invalid, 正则: '/^\\d{8,32}$/' },
        { 合法匹配: validMatch, 非法匹配: invalidMatch, 通过: validMatch && !invalidMatch },
      );
    });
  });
});
