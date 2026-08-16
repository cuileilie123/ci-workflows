import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GrantPermissionDto {
  @ApiProperty({ description: '被授权用户 ID（BigInt 字符串）', example: '12' })
  @IsString()
  @IsNotEmpty({ message: 'userId 不能为空' })
  userId!: string;

  @ApiProperty({
    description: '权限编码',
    example: 'PROFIT_SHARING_MANAGE',
    enum: ['PROFIT_SHARING_MANAGE', 'ORDER_PRICE_MANAGE', 'TASK_CATEGORY_MANAGE'],
  })
  @IsString()
  @IsNotEmpty({ message: 'permission 不能为空' })
  @Matches(/^(PROFIT_SHARING_MANAGE|ORDER_PRICE_MANAGE|TASK_CATEGORY_MANAGE)$/, {
    message: 'permission 取值非法',
  })
  permission!: string;
}
