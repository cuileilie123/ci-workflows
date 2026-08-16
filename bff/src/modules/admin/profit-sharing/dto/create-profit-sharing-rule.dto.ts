import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** 分段抽佣区间 */
export class CommissionTierDto {
  @ApiProperty({ description: '区间起始金额（含），第一段必须为 0', example: 0, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'rangeStart 最多 2 位小数' })
  @Min(0, { message: 'rangeStart 不能小于 0' })
  @Type(() => Number)
  rangeStart!: number;

  @ApiPropertyOptional({
    description: '区间结束金额（不含），最后一段为 null 表示无上限',
    example: 100,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'rangeEnd 最多 2 位小数' })
  @Min(0, { message: 'rangeEnd 不能小于 0' })
  @Type(() => Number)
  rangeEnd?: number | null;

  @ApiProperty({
    description: '该区间平台抽佣比例 0-1（0.1 = 10%）',
    example: 0.05,
    minimum: 0,
    maximum: 1,
  })
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'platformRate 最多 4 位小数' })
  @Min(0, { message: 'platformRate 不能小于 0' })
  @Max(1, { message: 'platformRate 不能大于 1' })
  @Type(() => Number)
  platformRate!: number;
}

export class CreateProfitSharingRuleDto {
  @ApiProperty({
    description: '规则名称',
    example: '跑腿送货默认分账',
    minLength: 2,
    maxLength: 64,
  })
  @IsString()
  @MinLength(2, { message: '规则名称至少 2 字' })
  @MaxLength(64, { message: '规则名称最多 64 字' })
  name!: string;

  @ApiPropertyOptional({
    description: '绑定的任务类别 ID（BigInt 字符串），空表示全局规则',
    example: '1',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({
    description: '抽佣模式: FLAT=单一比例, TIERED=分段抽佣',
    example: 'FLAT',
    enum: ['FLAT', 'TIERED'],
    default: 'FLAT',
  })
  @IsEnum(['FLAT', 'TIERED'])
  mode!: 'FLAT' | 'TIERED';

  @ApiPropertyOptional({
    description: '平台抽成比例 0-1（FLAT 模式必填，0.1 = 10%）',
    example: 0.1,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @ValidateIf((o) => o.mode === 'FLAT')
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'platformRate 最多 4 位小数' })
  @Min(0, { message: 'platformRate 不能小于 0' })
  @Max(1, { message: 'platformRate 不能大于 1' })
  @Type(() => Number)
  platformRate?: number;

  @ApiPropertyOptional({
    description: '分段抽佣区间（TIERED 模式必填）',
    type: [CommissionTierDto],
  })
  @IsOptional()
  @ValidateIf((o) => o.mode === 'TIERED')
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommissionTierDto)
  tiers?: CommissionTierDto[];

  @ApiPropertyOptional({
    description: '最低平台抽成（元，仅 FLAT 模式）',
    example: 0.5,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'minPlatformFee 最多 2 位小数' })
  @Min(0, { message: 'minPlatformFee 不能小于 0' })
  @Type(() => Number)
  minPlatformFee?: number;

  @ApiPropertyOptional({ description: '最高平台抽成（元，仅 FLAT 模式）', example: 50, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'maxPlatformFee 最多 2 位小数' })
  @Min(0, { message: 'maxPlatformFee 不能小于 0' })
  @Type(() => Number)
  maxPlatformFee?: number;

  @ApiPropertyOptional({ description: '是否启用', example: true, default: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({
    description: '生效起始时间（ISO datetime）',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({
    description: '生效截止时间（ISO datetime），必须晚于 validFrom',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiPropertyOptional({ description: '优先级，越大越先匹配', example: 0, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 }, { message: 'priority 必须为整数' })
  @Type(() => Number)
  priority?: number;
}
