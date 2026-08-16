import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreatePriceModificationDto {
  @ApiProperty({ description: '修改后的新价格（元）', example: 50, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'newPrice 最多 2 位小数' })
  @Min(0.01, { message: 'newPrice 必须大于 0' })
  @Type(() => Number)
  newPrice!: number;

  @ApiPropertyOptional({ description: '改价原因', example: '市场行情调整', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'reason 最多 500 字' })
  reason?: string;
}
