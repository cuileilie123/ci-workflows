import { IsOptional, IsString, MaxLength, Matches, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 绑定手机号 DTO：微信 getPhoneNumber 的 code 或直接传入手机号 */
export class BindPhoneDto {
  @ApiPropertyOptional({
    description: '微信 getPhoneNumber 返回的 code（推荐，服务端解码获取真实手机号）',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: '直接传入手机号（开发/测试用，生产环境建议使用 code）' })
  @IsOptional()
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone?: string;
}

/** 绑定银行卡 DTO */
export class BankCardDto {
  @ApiProperty({ description: '持卡人姓名', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  holderName!: string;

  @ApiProperty({ description: '银行名称', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  bankName!: string;

  @ApiProperty({ description: '银行卡号（16-19 位数字）' })
  @IsString()
  @Matches(/^\d{16,19}$/, { message: '银行卡号须为 16-19 位数字' })
  cardNumber!: string;

  @ApiPropertyOptional({ description: '是否设为默认卡' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** 实名认证 DTO */
export class RealNameDto {
  @ApiProperty({ description: '真实姓名', maxLength: 32 })
  @IsString()
  @MaxLength(32)
  @Matches(/^[\u4e00-\u9fa5·]{2,32}$/, { message: '姓名须为 2-32 位中文' })
  realName!: string;

  @ApiProperty({ description: '身份证号（18 位，最后一位可为 X）' })
  @IsString()
  @Matches(/^\d{17}[\dXx]$/, { message: '身份证号格式不正确' })
  idCardNumber!: string;
}
