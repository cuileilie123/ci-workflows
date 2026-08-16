import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { BindPhoneDto, BankCardDto, RealNameDto } from './dto/verification.dto';

// ---- 对外返回的脱敏接口类型 ----
export interface VerificationStatus {
  phoneBound: boolean;
  bankCardBound: boolean;
  realNameVerified: boolean;
  phone: string | null;
  realName: string | null;
  bankCardCount: number;
  canUseCoreFeatures: boolean;
  canWithdraw: boolean;
}

export interface BankCardInfo {
  id: string;
  holderName: string;
  bankName: string;
  cardNumberMasked: string;
  lastFour: string;
  isDefault: boolean;
  createdAt: Date;
}

export interface RealNameInfo {
  id: string;
  realName: string;
  idCardMasked: string;
  status: string;
  submittedAt: Date;
}

// ---- 微信 access_token 缓存 ----
interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

// ---- 脱敏工具 ----
function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

function maskRealName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

function maskIdCard(idCard: string): string {
  if (idCard.length < 10) return idCard;
  return idCard.slice(0, 6) + '********' + idCard.slice(-4);
}

function maskCardNumber(cardNumber: string): string {
  const lastFour = cardNumber.slice(-4);
  return '**** **** **** ' + lastFour;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly appid: string;
  private readonly secret: string;
  private cachedAccessToken: CachedAccessToken | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.appid = this.config.get<string>('WX_APPID') ?? '';
    this.secret = this.config.get<string>('WX_SECRET') ?? '';
  }

  // ============ 状态查询 ============
  async getStatus(userId: bigint): Promise<VerificationStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const bankCardCount = await this.prisma.bankCard.count({
      where: { userId },
    });
    const realName = await this.prisma.realNameVerification.findUnique({
      where: { userId },
    });

    const phoneBound = !!user.phone;
    const bankCardBound = bankCardCount > 0;
    const realNameVerified = !!realName && realName.status === 'VERIFIED';
    const allDone = phoneBound && bankCardBound && realNameVerified;

    return {
      phoneBound,
      bankCardBound,
      realNameVerified,
      phone: user.phone ? maskPhone(user.phone) : null,
      realName: realName?.realName ? maskRealName(realName.realName) : null,
      bankCardCount,
      canUseCoreFeatures: allDone,
      canWithdraw: allDone,
    };
  }

  // ============ 核心功能/提现前置校验（供 TaskService / WalletController 调用）============
  async requireVerified(userId: bigint): Promise<void> {
    const status = await this.getStatus(userId);
    if (status.canUseCoreFeatures) return;

    const missing: string[] = [];
    if (!status.phoneBound) missing.push('手机号绑定');
    if (!status.bankCardBound) missing.push('银行卡绑定');
    if (!status.realNameVerified) missing.push('实名认证');

    this.logger.warn(
      `[VERIFY] [LOG-VF-001] ❌ 用户未完成认证,拒绝核心功能: userId=${userId.toString()}, missing=[${missing.join(', ')}]`,
    );
    throw new ForbiddenException(`请先完成以下认证后使用此功能：${missing.join('、')}`);
  }

  // ============ 绑定手机号 ============
  async bindPhone(userId: bigint, dto: BindPhoneDto): Promise<{ phone: string }> {
    if (!dto.code && !dto.phone) {
      throw new BadRequestException('请提供微信手机号 code 或直接传入手机号');
    }

    let phone: string;
    if (dto.code) {
      phone = await this.getPhoneNumberByCode(dto.code);
    } else {
      phone = dto.phone!;
    }

    // 校验手机号是否已被其他用户绑定
    const existing = await this.prisma.user.findFirst({
      where: { phone, NOT: { id: userId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('该手机号已被其他账号绑定');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { phone },
    });

    this.logger.log(
      `[VERIFY] [LOG-VF-002] ✅ 手机号绑定成功: userId=${userId.toString()}, phone=${maskPhone(phone)}`,
    );
    return { phone: maskPhone(phone) };
  }

  // ============ 银行卡管理 ============
  async listBankCards(userId: bigint): Promise<BankCardInfo[]> {
    const cards = await this.prisma.bankCard.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return cards.map((c) => ({
      id: c.id.toString(),
      holderName: c.holderName,
      bankName: c.bankName,
      cardNumberMasked: maskCardNumber(c.cardNumber),
      lastFour: c.lastFour,
      isDefault: c.isDefault,
      createdAt: c.createdAt,
    }));
  }

  async addBankCard(userId: bigint, dto: BankCardDto): Promise<BankCardInfo> {
    // 实名认证通过后才能绑卡，且持卡人姓名须与实名姓名一致
    const realName = await this.prisma.realNameVerification.findUnique({
      where: { userId },
    });
    if (!realName || realName.status !== 'VERIFIED') {
      throw new ForbiddenException('请先完成实名认证后再绑定银行卡');
    }
    if (realName.realName !== dto.holderName) {
      throw new BadRequestException('持卡人姓名须与实名认证姓名一致');
    }

    // 检查是否已绑定相同卡号
    const dup = await this.prisma.bankCard.findFirst({
      where: { userId, cardNumber: dto.cardNumber },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException('该银行卡已绑定');
    }

    const lastFour = dto.cardNumber.slice(-4);

    // 如果是第一张卡或标记为默认，设为默认
    const cardCount = await this.prisma.bankCard.count({ where: { userId } });
    const isDefault = dto.isDefault ?? cardCount === 0;

    // 如果设为默认，先取消其他默认卡
    if (isDefault) {
      await this.prisma.bankCard.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const card = await this.prisma.bankCard.create({
      data: {
        userId,
        holderName: dto.holderName,
        bankName: dto.bankName,
        cardNumber: dto.cardNumber,
        lastFour,
        isDefault,
      },
    });

    this.logger.log(
      `[VERIFY] [LOG-VF-003] ✅ 银行卡绑定成功: userId=${userId.toString()}, lastFour=${lastFour}, bank=${dto.bankName}`,
    );

    return {
      id: card.id.toString(),
      holderName: card.holderName,
      bankName: card.bankName,
      cardNumberMasked: maskCardNumber(card.cardNumber),
      lastFour: card.lastFour,
      isDefault: card.isDefault,
      createdAt: card.createdAt,
    };
  }

  async deleteBankCard(userId: bigint, cardId: bigint): Promise<void> {
    const card = await this.prisma.bankCard.findFirst({
      where: { id: cardId, userId },
    });
    if (!card) throw new NotFoundException('银行卡不存在');

    await this.prisma.bankCard.delete({ where: { id: cardId } });

    // 如果删除的是默认卡，将最新的一张设为默认
    if (card.isDefault) {
      const next = await this.prisma.bankCard.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await this.prisma.bankCard.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    this.logger.log(
      `[VERIFY] [LOG-VF-004] ✅ 银行卡删除: userId=${userId.toString()}, cardId=${cardId.toString()}`,
    );
  }

  // ============ 实名认证 ============
  async getRealName(userId: bigint): Promise<RealNameInfo | null> {
    const rn = await this.prisma.realNameVerification.findUnique({
      where: { userId },
    });
    if (!rn) return null;
    return {
      id: rn.id.toString(),
      realName: maskRealName(rn.realName),
      idCardMasked: maskIdCard(rn.idCardNumber),
      status: rn.status,
      submittedAt: rn.submittedAt,
    };
  }

  async submitRealName(userId: bigint, dto: RealNameDto): Promise<RealNameInfo> {
    // 已认证则不允许重复提交
    const existing = await this.prisma.realNameVerification.findUnique({
      where: { userId },
    });
    if (existing && existing.status === 'VERIFIED') {
      throw new ConflictException('您已完成实名认证，无需重复提交');
    }

    // 校验身份证号校验位（简易校验）
    if (!isValidIdCard(dto.idCardNumber)) {
      throw new BadRequestException('身份证号校验失败，请检查后重试');
    }

    const rn = await this.prisma.realNameVerification.upsert({
      where: { userId },
      create: {
        userId,
        realName: dto.realName,
        idCardNumber: dto.idCardNumber,
        idCardLastFour: dto.idCardNumber.slice(-4),
        status: 'VERIFIED',
        reviewedAt: new Date(),
      },
      update: {
        realName: dto.realName,
        idCardNumber: dto.idCardNumber,
        idCardLastFour: dto.idCardNumber.slice(-4),
        status: 'VERIFIED',
        reviewedAt: new Date(),
      },
    });

    this.logger.log(
      `[VERIFY] [LOG-VF-005] ✅ 实名认证完成: userId=${userId.toString()}, realName=${maskRealName(dto.realName)}`,
    );

    return {
      id: rn.id.toString(),
      realName: maskRealName(rn.realName),
      idCardMasked: maskIdCard(rn.idCardNumber),
      status: rn.status,
      submittedAt: rn.submittedAt,
    };
  }

  // ============ 微信手机号解码 ============
  /** 通过微信 getPhoneNumber 的 code 获取手机号 */
  private async getPhoneNumberByCode(code: string): Promise<string> {
    const codePreview = code ? code.slice(0, 8) + '...' : '(空)';

    if (!this.appid || !this.secret) {
      this.logger.warn(
        `[VERIFY] [LOG-VF-101] ⚠️ WX_APPID/WX_SECRET 未配置，返回 mock 手机号（仅供本地联调）: code.preview=${codePreview}`,
      );
      // mock: 返回一个看似合理的手机号（仅供本地联调）
      return `138${String(Date.now()).slice(-8).padStart(8, '0')}`.slice(0, 11);
    }

    const accessToken = await this.getAppAccessToken();
    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      phone_info?: { phoneNumber?: string };
    };

    if (data.errcode) {
      this.logger.warn(
        `[VERIFY] [LOG-VF-102] ❌ 微信获取手机号失败: errcode=${data.errcode}, errmsg=${data.errmsg ?? ''}`,
      );
      throw new BadRequestException(`微信获取手机号失败: [${data.errcode}] ${data.errmsg ?? ''}`);
    }
    if (!data.phone_info?.phoneNumber) {
      throw new BadRequestException('微信返回手机号为空');
    }

    this.logger.log(
      `[VERIFY] [LOG-VF-103] ✅ 微信手机号获取成功: phone=${maskPhone(data.phone_info.phoneNumber)}`,
    );
    return data.phone_info.phoneNumber;
  }

  /** 获取微信 app access_token（带缓存） */
  private async getAppAccessToken(): Promise<string> {
    // 缓存有效期提前 5 分钟刷新
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.cachedAccessToken.token;
    }

    const url =
      `https://api.weixin.qq.com/cgi-bin/token` +
      `?grant_type=client_credential` +
      `&appid=${this.appid}` +
      `&secret=${this.secret}`;

    const res = await fetch(url, { method: 'GET' });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };

    if (data.errcode || !data.access_token) {
      this.logger.error(
        `[VERIFY] [LOG-VF-104] ❌ 获取微信 access_token 失败: errcode=${data.errcode}, errmsg=${data.errmsg ?? ''}`,
      );
      throw new BadRequestException(
        `获取微信 access_token 失败: [${data.errcode}] ${data.errmsg ?? ''}`,
      );
    }

    this.cachedAccessToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    };

    this.logger.log(
      `[VERIFY] [LOG-VF-105] ✅ 微信 access_token 获取成功, expiresIn=${data.expires_in ?? 7200}s`,
    );
    return data.access_token;
  }
}

// ---- 身份证校验位校验 ----
function isValidIdCard(idCard: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(idCard)) return false;
  // 加权因子
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(idCard[i], 10) * weights[i];
  }
  const checkCode = checkCodes[sum % 11];
  return idCard[17].toUpperCase() === checkCode;
}
