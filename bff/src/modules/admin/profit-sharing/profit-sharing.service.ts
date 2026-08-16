import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateProfitSharingRuleDto } from './dto/create-profit-sharing-rule.dto';
import { UpdateProfitSharingRuleDto } from './dto/update-profit-sharing-rule.dto';
import {
  WECHAT_CHANNEL_RATE,
  DEFAULT_PLATFORM_RATE,
  Tier,
  calcHelperRate,
  calcWechatFee,
  calculateTieredFee,
  calculateFlatFee,
  validateTiers as validateTiersUtil,
  validateFlatFeeRange as validateFlatFeeRangeUtil,
} from './profit-sharing.util';

// 向后兼容：其他模块（如 spec 文件）从 service 导入这些符号
export { WECHAT_CHANNEL_RATE, Tier };

@Injectable()
export class ProfitSharingService {
  private readonly logger = new Logger(ProfitSharingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 包装工具函数的校验错误为 BadRequestException */
  private wrapValidation(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  private validateValidWindow(validFrom?: string | null, validTo?: string | null): void {
    if (!validFrom || !validTo) return;
    const from = new Date(validFrom).getTime();
    const to = new Date(validTo).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) {
      throw new BadRequestException('validFrom 或 validTo 格式不正确');
    }
    if (to <= from) {
      throw new BadRequestException('validTo 必须晚于 validFrom');
    }
  }

  private async writeAuditLog(
    adminId: string,
    action: string,
    targetId: bigint,
    detail: unknown,
    ip?: string,
  ): Promise<void> {
    try {
      let adminBigInt: bigint | null = null;
      try {
        adminBigInt = BigInt(adminId);
      } catch {
        adminBigInt = null;
      }
      await this.prisma.auditLog.create({
        data: {
          adminId: adminBigInt,
          action,
          targetType: 'PROFIT_RULE',
          targetId,
          detail: (detail ?? {}) as Prisma.InputJsonValue,
          ip: ip ?? '127.0.0.1',
        },
      });
    } catch (err) {
      this.logger.warn(`写入审计日志失败: ${(err as Error).message}`);
    }
  }

  private toBigIntOrNull(value?: string | null): bigint | null {
    if (value === undefined || value === null || value === '') return null;
    return BigInt(value);
  }

  async create(dto: CreateProfitSharingRuleDto, adminId: string, ip?: string) {
    const mode = dto.mode || 'FLAT';
    const categoryId = this.toBigIntOrNull(dto.categoryId);

    let platformRate: number;
    let helperRate: number;
    let tiersJson: Prisma.InputJsonValue | null = null;
    let minPlatformFee: number | undefined = dto.minPlatformFee;
    let maxPlatformFee: number | undefined = dto.maxPlatformFee;

    if (mode === 'TIERED') {
      this.wrapValidation(() => validateTiersUtil(dto.tiers || []));
      tiersJson = dto.tiers as unknown as Prisma.InputJsonValue;
      // TIERED 模式下 platformRate/helperRate 存第一段的值（用于列表展示概览）
      const firstTier = [...(dto.tiers || [])].sort((a, b) => a.rangeStart - b.rangeStart)[0];
      platformRate = firstTier.platformRate;
      helperRate = calcHelperRate(firstTier.platformRate);
      // TIERED 模式不使用 min/maxPlatformFee
      minPlatformFee = undefined;
      maxPlatformFee = undefined;
    } else {
      // FLAT 模式
      platformRate = dto.platformRate ?? DEFAULT_PLATFORM_RATE;
      helperRate = calcHelperRate(platformRate);
      this.wrapValidation(() => validateFlatFeeRangeUtil(minPlatformFee, maxPlatformFee));
    }

    this.validateValidWindow(dto.validFrom, dto.validTo);

    const rule = await this.prisma.profitSharingRule.create({
      data: {
        name: dto.name,
        categoryId,
        mode,
        platformRate,
        helperRate,
        tiers: tiersJson ?? Prisma.JsonNull,
        minPlatformFee: minPlatformFee ?? null,
        maxPlatformFee: maxPlatformFee ?? null,
        isActive: dto.isActive ?? true,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        priority: dto.priority ?? 0,
      },
    });

    this.logger.log(
      `创建分账规则成功: id=${rule.id.toString()}, name=${rule.name}, mode=${mode}, adminId=${adminId}`,
    );

    await this.writeAuditLog(adminId, 'CREATE', rule.id, dto, ip);

    return this.serialize(rule);
  }

  async findAll() {
    const rules = await this.prisma.profitSharingRule.findMany({
      include: { category: { select: { name: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return rules.map((rule) => ({
      ...this.serialize(rule),
      categoryName: rule.category?.name,
    }));
  }

  async findOne(id: string) {
    const rule = await this.prisma.profitSharingRule.findUnique({
      where: { id: BigInt(id) },
      include: { category: { select: { name: true } } },
    });

    if (!rule) throw new NotFoundException('分账规则不存在');

    return {
      ...this.serialize(rule),
      categoryName: rule.category?.name,
    };
  }

  /**
   * 用户端只读视图：仅返回当前生效（active + 在有效期内）的分账规则。
   * 接单用户在结算/提现时可查看分佣比例，但不可编辑。
   */
  async findActiveRules() {
    const now = new Date();
    const rules = await this.prisma.profitSharingRule.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gt: now } }] },
        ],
      },
      include: { category: { select: { name: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return rules.map((rule) => ({
      id: rule.id.toString(),
      name: rule.name,
      categoryId: rule.categoryId !== null ? rule.categoryId.toString() : null,
      categoryName: rule.category?.name,
      mode: rule.mode,
      platformRate: Number(rule.platformRate),
      helperRate: Number(rule.helperRate),
      tiers: rule.tiers as unknown as Tier[] | null,
      isActive: rule.isActive,
      priority: rule.priority,
    }));
  }

  /** 微信支付渠道费率（0.6%，底层硬编码，仅读取展示） */
  getWechatChannelRate(): { rate: number; percent: number; description: string } {
    return {
      rate: WECHAT_CHANNEL_RATE,
      percent: WECHAT_CHANNEL_RATE * 100,
      description: '微信支付渠道手续费（支付给微信支付平台，不可修改）',
    };
  }

  async update(id: string, dto: UpdateProfitSharingRuleDto, adminId: string, ip?: string) {
    const ruleId = BigInt(id);

    const existing = await this.prisma.profitSharingRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) throw new NotFoundException('分账规则不存在');

    const mode = dto.mode || existing.mode;

    let platformRate: number;
    let helperRate: number;
    let tiersJson: Prisma.InputJsonValue | null;
    let minPlatformFee: number | null;
    let maxPlatformFee: number | null;

    if (mode === 'TIERED') {
      const tiers = dto.tiers || (existing.tiers as Tier[] | null);
      if (!tiers) throw new BadRequestException('TIERED 模式必须提供 tiers');
      this.wrapValidation(() => validateTiersUtil(tiers));
      tiersJson = tiers as unknown as Prisma.InputJsonValue;
      const sorted = [...tiers].sort((a, b) => a.rangeStart - b.rangeStart);
      platformRate = sorted[0].platformRate;
      helperRate = calcHelperRate(platformRate);
      minPlatformFee = null;
      maxPlatformFee = null;
    } else {
      platformRate = dto.platformRate ?? Number(existing.platformRate);
      helperRate = calcHelperRate(platformRate);
      tiersJson = null;
      minPlatformFee =
        dto.minPlatformFee !== undefined
          ? dto.minPlatformFee
          : existing.minPlatformFee !== null
            ? Number(existing.minPlatformFee)
            : null;
      maxPlatformFee =
        dto.maxPlatformFee !== undefined
          ? dto.maxPlatformFee
          : existing.maxPlatformFee !== null
            ? Number(existing.maxPlatformFee)
            : null;
      this.wrapValidation(() => validateFlatFeeRangeUtil(minPlatformFee, maxPlatformFee));
    }

    const categoryId =
      dto.categoryId !== undefined ? this.toBigIntOrNull(dto.categoryId) : existing.categoryId;

    const validFrom =
      dto.validFrom !== undefined
        ? dto.validFrom
          ? new Date(dto.validFrom)
          : null
        : existing.validFrom;

    const validTo =
      dto.validTo !== undefined ? (dto.validTo ? new Date(dto.validTo) : null) : existing.validTo;

    if (validFrom && validTo && validTo <= validFrom) {
      throw new BadRequestException('validTo 必须晚于 validFrom');
    }

    const updated = await this.prisma.profitSharingRule.update({
      where: { id: ruleId },
      data: {
        name: dto.name,
        categoryId,
        mode,
        platformRate,
        helperRate,
        tiers: tiersJson ?? Prisma.JsonNull,
        minPlatformFee,
        maxPlatformFee,
        isActive: dto.isActive,
        validFrom,
        validTo,
        priority: dto.priority,
      },
    });

    this.logger.log(
      `更新分账规则成功: id=${updated.id.toString()}, mode=${mode}, adminId=${adminId}`,
    );

    await this.writeAuditLog(adminId, 'UPDATE', ruleId, dto, ip);

    return this.serialize(updated);
  }

  async remove(id: string, adminId: string, ip?: string): Promise<{ success: boolean }> {
    const ruleId = BigInt(id);

    const existing = await this.prisma.profitSharingRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) throw new NotFoundException('分账规则不存在');

    await this.prisma.profitSharingRule.delete({
      where: { id: ruleId },
    });

    this.logger.log(`删除分账规则成功: id=${id}, adminId=${adminId}`);

    await this.writeAuditLog(adminId, 'DELETE', ruleId, { name: existing.name }, ip);

    return { success: true };
  }

  /**
   * 计算分账金额。
   * - FLAT 模式：platformFee = total * platformRate（受 min/max 约束）
   * - TIERED 模式：逐段累进计算，类似个人所得税
   *
   * 接单者收入 = totalAmount - platformFee - wechatFee
   * 其中 wechatFee = totalAmount * WECHAT_CHANNEL_RATE (0.6%)
   */
  async calculate(
    totalAmount: number | Prisma.Decimal,
    categoryId?: bigint | string | null,
  ): Promise<{
    platformFee: number;
    wechatFee: number;
    helperAmount: number;
    ruleId: string;
    mode: string;
    platformRate: number;
    helperRate: number;
  }> {
    const total = Number(totalAmount);
    const now = new Date();

    const catId =
      typeof categoryId === 'string'
        ? categoryId
          ? BigInt(categoryId)
          : null
        : (categoryId ?? null);

    let matchedRule: {
      id: bigint;
      mode: string;
      platformRate: Prisma.Decimal;
      helperRate: Prisma.Decimal;
      minPlatformFee: Prisma.Decimal | null;
      maxPlatformFee: Prisma.Decimal | null;
      tiers: Prisma.JsonValue;
    } | null = null;

    if (catId !== null) {
      matchedRule = await this.prisma.profitSharingRule.findFirst({
        where: {
          categoryId: catId,
          isActive: true,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validTo: null }, { validTo: { gt: now } }] },
          ],
        },
        orderBy: { priority: 'desc' },
        select: {
          id: true,
          mode: true,
          platformRate: true,
          helperRate: true,
          minPlatformFee: true,
          maxPlatformFee: true,
          tiers: true,
        },
      });
    }

    if (!matchedRule) {
      matchedRule = await this.prisma.profitSharingRule.findFirst({
        where: {
          categoryId: null,
          isActive: true,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validTo: null }, { validTo: { gt: now } }] },
          ],
        },
        orderBy: { priority: 'desc' },
        select: {
          id: true,
          mode: true,
          platformRate: true,
          helperRate: true,
          minPlatformFee: true,
          maxPlatformFee: true,
          tiers: true,
        },
      });
    }

    // 微信支付渠道费（从接单者收入中扣除）
    const wechatFee = calcWechatFee(total);

    let platformFee: number;
    let ruleId: string;
    let mode: string;
    let displayPlatformRate: number;
    let displayHelperRate: number;

    if (matchedRule) {
      mode = matchedRule.mode;
      ruleId = matchedRule.id.toString();
      displayPlatformRate = Number(matchedRule.platformRate);
      displayHelperRate = Number(matchedRule.helperRate);

      if (mode === 'TIERED') {
        platformFee = calculateTieredFee(total, (matchedRule.tiers as unknown as Tier[]) || []).fee;
      } else {
        // FLAT 模式
        const platformRate = Number(matchedRule.platformRate);
        const minFee =
          matchedRule.minPlatformFee !== null ? Number(matchedRule.minPlatformFee) : null;
        const maxFee =
          matchedRule.maxPlatformFee !== null ? Number(matchedRule.maxPlatformFee) : null;
        platformFee = calculateFlatFee(total, platformRate, minFee, maxFee);
      }
    } else {
      // 默认规则
      mode = 'FLAT';
      platformFee = total * DEFAULT_PLATFORM_RATE;
      ruleId = 'DEFAULT';
      displayPlatformRate = DEFAULT_PLATFORM_RATE;
      displayHelperRate = calcHelperRate(DEFAULT_PLATFORM_RATE);
      this.logger.warn(`未匹配到分账规则，使用默认规则: platform=${DEFAULT_PLATFORM_RATE * 100}%`);
    }

    platformFee = Math.round(platformFee * 100) / 100;

    // 接单者收入 = 总额 - 平台抽佣 - 微信支付渠道费
    let helperAmount = total - platformFee - wechatFee;
    helperAmount = Math.round(helperAmount * 100) / 100;

    if (helperAmount < 0) {
      helperAmount = 0;
      platformFee = total - wechatFee;
      platformFee = Math.round(platformFee * 100) / 100;
    }

    return {
      platformFee,
      wechatFee,
      helperAmount,
      ruleId,
      mode,
      platformRate: displayPlatformRate,
      helperRate: displayHelperRate,
    };
  }

  private serialize(rule: {
    id: bigint;
    name: string;
    categoryId: bigint | null;
    mode: string;
    platformRate: Prisma.Decimal | number;
    helperRate: Prisma.Decimal | number;
    tiers: Prisma.JsonValue;
    minPlatformFee: Prisma.Decimal | number | null;
    maxPlatformFee: Prisma.Decimal | number | null;
    isActive: boolean;
    validFrom: Date | null;
    validTo: Date | null;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: rule.id.toString(),
      name: rule.name,
      categoryId: rule.categoryId !== null ? rule.categoryId.toString() : null,
      mode: rule.mode,
      platformRate: Number(rule.platformRate),
      helperRate: Number(rule.helperRate),
      tiers: rule.tiers as unknown as Tier[] | null,
      minPlatformFee: rule.minPlatformFee !== null ? Number(rule.minPlatformFee) : null,
      maxPlatformFee: rule.maxPlatformFee !== null ? Number(rule.maxPlatformFee) : null,
      isActive: rule.isActive,
      validFrom: rule.validFrom ? rule.validFrom.toISOString() : null,
      validTo: rule.validTo ? rule.validTo.toISOString() : null,
      priority: rule.priority,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}
