import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ description: '任务ID' })
  @IsString()
  @IsNotEmpty()
  taskId!: string;
}
