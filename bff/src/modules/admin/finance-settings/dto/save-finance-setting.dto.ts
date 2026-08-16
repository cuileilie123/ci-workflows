import {
  IsString,
  IsBoolean,
  IsOptional,
  IsEnum,
  MaxLength,
  Matches,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export const RECEIVER_TYPES = ['MERCHANT_ID', 'PERSONAL_OPENID'] as const;
export type ReceiverType = (typeof RECEIVER_TYPES)[number];

/**
 * 保存平台财务设置 DTO（单例 upsert）
 */
export class SaveFinanceSettingDto {
  // ========== 分账总控 ==========
  @ApiProperty({
    description: '是否启用分账（关闭则不分账，钱留在主商户号，仅系统内做账）',
    example: true,
    default: true,
  })
  @IsBoolean()
  @Type(() => Boolean)
  profitSharingEnabled!: boolean;

  // ========== 佣金收款账号（分账接收方） ==========
  @ApiProperty({
    description: '接收方类型：MERCHANT_ID = 微信支付商户号（推荐）；PERSONAL_OPENID = 个人零钱',
    example: 'MERCHANT_ID',
    enum: RECEIVER_TYPES,
    default: 'MERCHANT_ID',
  })
  @IsEnum(RECEIVER_TYPES)
  receiverType!: ReceiverType;

  @ApiPropertyOptional({
    description: '接收方商户号（receiverType=MERCHANT_ID 时必填，纯数字 8~32 位）',
    example: '1600000000',
  })
  @ValidateIf((o: SaveFinanceSettingDto) => o.receiverType === 'MERCHANT_ID' && o.profitSharingEnabled)
  @IsNotEmpty({ message: '接收方类型为商户号时，商户号必填' })
  @Matches(/^\d{8,32}$/, { message: '商户号必须是 8~32 位数字' })
  receiverMchId?: string | null;

  @ApiPropertyOptional({
    description: '接收方名称（MERCHANT_ID 时建议填写，需与微信商户平台登记的主体名称一致）',
    example: 'XX 科技有限公司',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128, { message: '接收方名称最多 128 字' })
  receiverName?: string | null;

  @ApiPropertyOptional({
    description: '接收方个人 openid（receiverType=PERSONAL_OPENID 时必填）',
    example: 'oABC1234567890abcdef',
  })
  @ValidateIf((o: SaveFinanceSettingDto) => o.receiverType === 'PERSONAL_OPENID' && o.profitSharingEnabled)
  @IsNotEmpty({ message: '接收方类型为个人时，openid 必填' })
  @IsString()
  @MaxLength(64)
  receiverOpenid?: string | null;

  // ========== 主商户号 & AppID（可选覆盖 env，方便老板直接改） ==========
  @ApiPropertyOptional({
    description: '主商户号（可选覆盖 .env WX_MCH_ID；为空则回落到 .env）',
    example: '1600000001',
  })
  @IsOptional()
  @Matches(/^\d{8,32}$/, { message: '主商户号必须是 8~32 位数字' })
  mainMchId?: string | null;

  @ApiPropertyOptional({
    description: '小程序 AppID（可选覆盖 .env WX_APP_ID；为空则回落到 .env）',
    example: 'wxc1234567890abcdef',
  })
  @IsOptional()
  @Matches(/^wx[a-f0-9]{16}$/, { message: 'AppID 格式应为 wx 开头 + 16 位小写字母/数字' })
  mainAppId?: string | null;
}
