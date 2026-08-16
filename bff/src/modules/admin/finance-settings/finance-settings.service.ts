import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaveFinanceSettingDto } from './dto/save-finance-setting.dto';
import type { ProfitSharingReceiver } from '../../payment/wx-pay.util';

/**
 * 平台财务设置服务
 * - 单例：id=1，只有一行
 * - 仅 BOSS/SUPER_ADMIN 可编辑
 * - 支付模块调用 getActiveProfitSharingReceiver() 获取当前生效的接收方配置
 *   （优先级：DB > .env）
 * - 主商户号 / AppID 通过内存缓存读取（TTL 30s），避免每次签名都打 DB
 */
@Injectable()
export class FinanceSettingsService {
  private readonly logger = new Logger(FinanceSettingsService.name);
  /** PlatformFinanceSetting 在 DB 中作为单例，主键固定为 1 */
  private readonly SINGLETON_ID = 1n;
  /** 主商户号 / AppID 缓存 TTL（毫秒），避免每次签名都打 DB */
  private readonly CACHE_TTL_MS = 30_000;
  /** 内存缓存：mainMchId / mainAppId 的 DB 覆盖值 */
  private mainConfigCache: {
    mainMchId: string | null;
    mainAppId: string | null;
    loadedAt: number;
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // 老板端：读 / 写
  // ============================================================

  async get(): Promise<{
    id: string;
    profitSharingEnabled: boolean;
    receiverType: string;
    receiverMchId: string | null;
    receiverName: string | null;
    receiverOpenid: string | null;
    mainMchId: string | null;
    mainAppId: string | null;
    updatedBy: string | null;
    updatedAt: Date;
    createdAt: Date;
  } | null> {
    this.logger.log(`[FS-LOG] get() 入口: SINGLETON_ID=${this.SINGLETON_ID}`);

    const row = await this.prisma.platformFinanceSetting.findUnique({
      where: { id: this.SINGLETON_ID },
    });

    if (!row) {
      this.logger.log(`[FS-LOG] get() DB 无记录，返回 null`);
      return null;
    }

    this.logger.log(
      `[FS-LOG] get() DB 命中: id=${row.id}, profitSharingEnabled=${row.profitSharingEnabled}, ` +
        `receiverType=${row.receiverType}, ` +
        `receiverMchId=${row.receiverMchId ? '已配置' : '未配置'}, ` +
        `updatedBy=${row.updatedBy ?? '-'}`,
    );

    return {
      id: row.id.toString(),
      profitSharingEnabled: row.profitSharingEnabled,
      receiverType: row.receiverType,
      receiverMchId: row.receiverMchId,
      receiverName: row.receiverName,
      receiverOpenid: row.receiverOpenid,
      mainMchId: row.mainMchId,
      mainAppId: row.mainAppId,
      updatedBy: row.updatedBy ? row.updatedBy.toString() : null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
  }

  async save(
    dto: SaveFinanceSettingDto,
    bossId: string,
    ip?: string,
  ): Promise<
    {
      id: string;
      profitSharingEnabled: boolean;
      receiverType: string;
      receiverMchId: string | null;
      receiverName: string | null;
      receiverOpenid: string | null;
      mainMchId: string | null;
      mainAppId: string | null;
      updatedBy: string | null;
      updatedAt: Date;
      createdAt: Date;
      source: 'created' | 'updated';
    }
  > {
    // 1. 字段交叉校验
    this.logger.log(
      `[FS-LOG] save() 入口: bossId=${bossId}, ip=${ip ?? '-'}, ` +
        `profitSharingEnabled=${dto.profitSharingEnabled}, receiverType=${dto.receiverType}, ` +
        `receiverMchId=${dto.receiverMchId ? '已配置' : '未配置'}, receiverName=${dto.receiverName ?? '-'}`,
    );
    this.validateCross(dto);
    this.logger.log(`[FS-LOG] save() 校验通过`);

    // 2. 转换 bigint 的 bossId
    let bossBigInt: bigint | null = null;
    try {
      bossBigInt = BigInt(bossId);
    } catch {
      this.logger.warn(`[FS-LOG] save() bossId 非数字: "${bossId}"，updatedBy 将为 null`);
      bossBigInt = null;
    }

    // 3. upsert（单例，id=1）
    const data = {
      profitSharingEnabled: dto.profitSharingEnabled,
      receiverType: dto.receiverType,
      receiverMchId: dto.receiverMchId ?? null,
      receiverName: dto.receiverName ?? null,
      receiverOpenid: dto.receiverOpenid ?? null,
      mainMchId: dto.mainMchId ?? null,
      mainAppId: dto.mainAppId ?? null,
      updatedBy: bossBigInt,
    };

    const existing = await this.prisma.platformFinanceSetting.findUnique({
      where: { id: this.SINGLETON_ID },
    });

    this.logger.log(
      `[FS-LOG] save() DB 查询: existing=${existing ? '有记录' : '无记录'}, ` +
        `将执行 ${existing ? 'update' : 'create'}`,
    );

    const row = existing
      ? await this.prisma.platformFinanceSetting.update({
          where: { id: this.SINGLETON_ID },
          data,
        })
      : await this.prisma.platformFinanceSetting.create({
          data: { id: this.SINGLETON_ID, ...data },
        });

    this.logger.log(
      `[FINANCE-SETTING] ${existing ? '更新' : '新增'}平台财务设置: bossId=${bossId} ip=${ip ?? '-'} ` +
        `profitSharingEnabled=${dto.profitSharingEnabled} ` +
        `receiverType=${dto.receiverType} ` +
        `receiverMchId=${dto.receiverMchId ? '已配置' : '未配置'} ` +
        `receiverName=${dto.receiverName ?? '-'}`,
    );
    this.logger.log(
      `[FS-LOG] save() 写入完成: source=${existing ? 'updated' : 'created'}, ` +
        `rowId=${row.id}, updatedBy=${row.updatedBy ?? 'null'}`,
    );

    // 写入后立即清空主商户号/AppID 缓存，确保下次读取拿到最新值
    if (this.mainConfigCache) {
      this.logger.log(`[FS-LOG] save() 清空 mainConfigCache（旧值 mchId=${this.mainConfigCache.mainMchId ? '已配置' : '空'}）`);
      this.mainConfigCache = null;
    }

    // 4. 写审计日志
    try {
      await this.prisma.auditLog.create({
        data: {
          adminId: bossBigInt,
          action: existing ? 'FINANCE_SETTING_UPDATE' : 'FINANCE_SETTING_CREATE',
          targetType: 'PlatformFinanceSetting',
          targetId: this.SINGLETON_ID,
          detail: {
            ...dto,
            receiverMchId: dto.receiverMchId ? `${dto.receiverMchId.slice(0, 4)}***${dto.receiverMchId.slice(-4)}` : null,
            receiverOpenid: dto.receiverOpenid ? `${dto.receiverOpenid.slice(0, 4)}***${dto.receiverOpenid.slice(-4)}` : null,
          },
          ip: ip ?? null,
        },
      });
      this.logger.log(`[FS-LOG] save() 审计日志写入成功: action=${existing ? 'FINANCE_SETTING_UPDATE' : 'FINANCE_SETTING_CREATE'}`);
    } catch (err) {
      this.logger.warn(`[FINANCE-SETTING] 审计日志写入失败: ${(err as Error).message}`);
    }

    return {
      id: row.id.toString(),
      profitSharingEnabled: row.profitSharingEnabled,
      receiverType: row.receiverType,
      receiverMchId: row.receiverMchId,
      receiverName: row.receiverName,
      receiverOpenid: row.receiverOpenid,
      mainMchId: row.mainMchId,
      mainAppId: row.mainAppId,
      updatedBy: row.updatedBy ? row.updatedBy.toString() : null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      source: existing ? 'updated' : 'created',
    };
  }

  private validateCross(dto: SaveFinanceSettingDto): void {
    if (dto.profitSharingEnabled) {
      if (dto.receiverType === 'MERCHANT_ID' && !dto.receiverMchId) {
        this.logger.warn(`[FS-LOG] validateCross 拒绝: profitSharingEnabled=true, receiverType=MERCHANT_ID, 但 receiverMchId 为空`);
        throw new BadRequestException('启用分账且接收方类型为商户号时，商户号必填');
      }
      if (dto.receiverType === 'PERSONAL_OPENID' && !dto.receiverOpenid) {
        this.logger.warn(`[FS-LOG] validateCross 拒绝: profitSharingEnabled=true, receiverType=PERSONAL_OPENID, 但 receiverOpenid 为空`);
        throw new BadRequestException('启用分账且接收方类型为个人时，openid 必填');
      }
    } else {
      this.logger.log(`[FS-LOG] validateCross 跳过: profitSharingEnabled=false, 不校验接收方`);
    }
  }

  // ============================================================
  // 给支付模块调用：获取当前生效的分账接收方（优先级 DB > .env）
  // ============================================================

  async getActiveProfitSharingReceiver(): Promise<ProfitSharingReceiver> {
    const row = await this.prisma.platformFinanceSetting.findUnique({
      where: { id: this.SINGLETON_ID },
    });

    // 1. DB 有配置，且启用了分账 + 填了 receiver → 使用 DB
    if (row && row.profitSharingEnabled) {
      if (row.receiverType === 'MERCHANT_ID' && row.receiverMchId) {
        this.logger.log(
          `[FS-LOG] getActiveReceiver 来源=DB(MERCHANT_ID): mchId=${row.receiverMchId.slice(0, 4)}***${row.receiverMchId.slice(-4)}, name=${row.receiverName || '平台佣金账户'}`,
        );
        return {
          enabled: true,
          mchId: row.receiverMchId,
          name: row.receiverName || '平台佣金账户',
        };
      }
      if (row.receiverType === 'PERSONAL_OPENID' && row.receiverOpenid) {
        this.logger.log(
          `[FS-LOG] getActiveReceiver 来源=DB(PERSONAL_OPENID): openid=${row.receiverOpenid.slice(0, 4)}***${row.receiverOpenid.slice(-4)}, name=${row.receiverName || '平台佣金账户'}`,
        );
        return {
          enabled: true,
          mchId: row.receiverOpenid,
          name: row.receiverName || '平台佣金账户',
        };
      }
    }

    // 2. DB 没配置或关闭了分账 → 回落到 .env
    const envEnabled = process.env.WX_PROFIT_SHARING_ENABLED !== 'false';
    const envMchId = process.env.WX_PROFIT_SHARING_RECEIVER_MCH_ID || '';
    const envName = process.env.WX_PROFIT_SHARING_RECEIVER_NAME || '平台佣金账户';

    this.logger.log(
      `[FS-LOG] getActiveReceiver 来源=env(回落): ` +
        `DB=${row ? (row.profitSharingEnabled ? '启用但无接收方' : '关闭分账') : '无记录'}, ` +
        `envEnabled=${envEnabled}, envMchId=${envMchId ? envMchId.slice(0, 4) + '***' + envMchId.slice(-4) : '(空)'}`,
    );

    return {
      enabled: envEnabled && !!envMchId,
      mchId: envMchId,
      name: envName,
    };
  }

  /**
   * 获取当前生效的主商户号（DB > env）
   * - 通过内存缓存（TTL 30s）读取 DB 覆盖值，避免每次签名都打 DB
   * - DB 未配置或读取失败 → 回落到 env.WX_MCH_ID
   */
  async getActiveMainMchId(): Promise<string> {
    const cache = await this.loadMainConfigIfNeeded();
    if (cache.mainMchId) {
      this.logger.log(
        `[FS-LOG] getActiveMainMchId 来源=DB: mchId=${cache.mainMchId.slice(0, 4)}***${cache.mainMchId.slice(-4)}`,
      );
      return cache.mainMchId;
    }
    const envVal = process.env.WX_MCH_ID || '';
    this.logger.log(
      `[FS-LOG] getActiveMainMchId 来源=env(回落): envMchId=${envVal ? envVal.slice(0, 4) + '***' + envVal.slice(-4) : '(空)'}`,
    );
    return envVal;
  }

  /**
   * 获取当前生效的 AppID（DB > env）
   * - 通过内存缓存（TTL 30s）读取 DB 覆盖值
   * - DB 未配置或读取失败 → 回落到 env.WX_APP_ID
   */
  async getActiveAppId(): Promise<string> {
    const cache = await this.loadMainConfigIfNeeded();
    if (cache.mainAppId) {
      this.logger.log(
        `[FS-LOG] getActiveAppId 来源=DB: appId=${cache.mainAppId.slice(0, 6)}***`,
      );
      return cache.mainAppId;
    }
    const envVal = process.env.WX_APP_ID || '';
    this.logger.log(
      `[FS-LOG] getActiveAppId 来源=env(回落): envAppId=${envVal ? envVal.slice(0, 6) + '***' : '(空)'}`,
    );
    return envVal;
  }

  /**
   * 加载主商户号/AppID 配置到内存缓存（带 TTL）
   * - 缓存未失效时直接返回缓存值，不查 DB
   * - 缓存失效或为空时从 DB 读取一次并写入缓存
   * - DB 查询失败时降级返回空值（不抛异常），由调用方回落到 env
   */
  private async loadMainConfigIfNeeded(): Promise<{
    mainMchId: string | null;
    mainAppId: string | null;
  }> {
    const now = Date.now();
    if (this.mainConfigCache && now - this.mainConfigCache.loadedAt < this.CACHE_TTL_MS) {
      return this.mainConfigCache;
    }

    try {
      const row = await this.prisma.platformFinanceSetting.findUnique({
        where: { id: this.SINGLETON_ID },
        select: { mainMchId: true, mainAppId: true },
      });
      this.mainConfigCache = {
        mainMchId: row?.mainMchId ?? null,
        mainAppId: row?.mainAppId ?? null,
        loadedAt: now,
      };
      this.logger.log(
        `[FS-LOG] loadMainConfig DB 命中: mainMchId=${this.mainConfigCache.mainMchId ? '已配置' : '空'}, ` +
          `mainAppId=${this.mainConfigCache.mainAppId ? '已配置' : '空'}`,
      );
    } catch (err) {
      // DB 查询失败时降级：缓存空值，避免每次请求都重试 DB
      this.mainConfigCache = {
        mainMchId: null,
        mainAppId: null,
        loadedAt: now,
      };
      this.logger.warn(
        `[FS-LOG] loadMainConfig DB 查询失败，降级返回空（调用方回落 env）: ${(err as Error).message}`,
      );
    }
    return this.mainConfigCache;
  }

  /**
   * 手动清除主商户号/AppID 缓存（供测试或其他需要强制刷新的场景使用）
   */
  clearMainConfigCache(): void {
    this.mainConfigCache = null;
    this.logger.log(`[FS-LOG] clearMainConfigCache() 缓存已手动清空`);
  }
}
