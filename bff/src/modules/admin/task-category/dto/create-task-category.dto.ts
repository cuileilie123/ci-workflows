import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsUrl,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskCategoryDto {
  @ApiProperty({
    description: '类别编码（唯一）',
    example: 'DELIVERY',
    minLength: 2,
    maxLength: 32,
  })
  @IsString()
  @MinLength(2, { message: '编码长度至少 2 位' })
  @MaxLength(32, { message: '编码长度最多 32 位' })
  code!: string;

  @ApiProperty({ description: '类别名称', example: '跑腿送货', minLength: 2, maxLength: 32 })
  @IsString()
  @MinLength(2, { message: '名称长度至少 2 位' })
  @MaxLength(32, { message: '名称长度最多 32 位' })
  name!: string;

  @ApiPropertyOptional({
    description: '图标 URL',
    example: 'https://example.com/icons/delivery.png',
  })
  @IsOptional()
  @IsString()
  @IsUrl({}, { message: '图标必须是合法的 URL' })
  @MaxLength(256, { message: '图标 URL 长度最多 256 位' })
  icon?: string;

  @ApiPropertyOptional({ description: '排序（升序）', example: 0, default: 0 })
  @IsOptional()
  @IsNumber({}, { message: '排序必须是数字' })
  sort?: number;

  @ApiPropertyOptional({ description: '是否启用', example: true, default: true })
  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}
