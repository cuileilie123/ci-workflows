import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class QueryTaskDto {
  @ApiPropertyOptional({ description: '纬度', example: 23.1291 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({ description: '经度', example: 113.2644 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng?: number;

  @ApiPropertyOptional({ description: '页码（从 1 开始）', example: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: '任务类别 ID 筛选（关联 task_categories 表）', example: '1' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '搜索关键词', example: '快递' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: '是否只看我发布的任务', example: true })
  @IsOptional()
  @Type(() => Boolean)
  mine?: boolean;

  @ApiPropertyOptional({ description: '是否只看我接的任务', example: true })
  @IsOptional()
  @Type(() => Boolean)
  helper?: boolean;
}
