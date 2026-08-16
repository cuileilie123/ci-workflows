import { IsNumber, IsNotEmpty, Min, Max, IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class WithdrawDto {
  @IsNumber({}, { message: '提现金额必须为数字' })
  @IsNotEmpty({ message: '提现金额不能为空' })
  @Min(1, { message: '最低提现 1 元' })
  @Max(5000, { message: '单笔提现不能超过 5000 元' })
  amount!: number;
}

export class TransferDto {
  @IsNumber({}, { message: '转账金额必须为数字' })
  @IsNotEmpty({ message: '转账金额不能为空' })
  @Min(0.01, { message: '最低转账 0.01 元' })
  amount!: number;

  @IsNotEmpty({ message: '接收方用户ID不能为空' })
  toUserId!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class TransactionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn(['INCOME', 'EXPENSE', 'FREEZE', 'UNFREEZE'])
  type?: 'INCOME' | 'EXPENSE' | 'FREEZE' | 'UNFREEZE';
}
