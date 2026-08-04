import {
  IsString,
  IsEnum,
  IsNumber,
  IsArray,
  IsOptional,
  IsDateString,
  Min,
  Max,
  MinLength,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TaskCategory } from '@prisma/client';

export class CreateTaskDto {
  @ApiProperty({ description: '任务标题', example: '帮取快递', minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2, { message: '标题至少 2 字' })
  @MaxLength(50, { message: '标题最多 50 字' })
  title!: string;

  @ApiProperty({ description: '任务分类', enum: TaskCategory, example: 'DELIVERY' })
  @IsEnum(TaskCategory, { message: '分类不合法' })
  category!: TaskCategory;

  @ApiProperty({
    description: '任务描述',
    example: '丰巢取件码 A1234',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @MinLength(10, { message: '描述至少 10 字' })
  @MaxLength(500, { message: '描述最多 500 字' })
  description!: string;

  @ApiProperty({ description: '报酬金额（元）', example: 5.5, minimum: 0.01, maximum: 10000 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '金额最多两位小数' })
  @Min(0.01, { message: '金额至少 0.01' })
  @Max(10000, { message: '金额最多 10000' })
  price!: number;

  @ApiProperty({ description: '纬度', example: 23.1291, minimum: -90, maximum: 90 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat!: number;

  @ApiProperty({ description: '经度', example: 113.2644, minimum: -180, maximum: 180 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng!: number;

  @ApiProperty({ description: 'POI 名称 + 详细地址', example: '天河城-西门' })
  @IsString()
  @MaxLength(256)
  address!: string;

  @ApiPropertyOptional({
    description: '图片 fileKey/URL 列表（最多 6 张，上传 COS 后获得）',
    type: [String],
    example: ['tasks/2026/01/abc.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6, { message: '图片最多 6 张' })
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({
    description: '截止时间（默认 24h 后）',
    example: '2026-08-02T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  expireAt?: string;
}
