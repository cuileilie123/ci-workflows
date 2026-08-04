import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** 微信授权用户信息（前端 chooseAvatar + nickname 输入） */
export interface WxUserInfo {
  nickname?: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

export class WxLoginDto {
  @ApiProperty({
    description: 'wx.login() 返回的临时 code（5 分钟有效）',
    example: '0a3xxxxxxxxxxxxx',
  })
  @IsString()
  @IsNotEmpty({ message: 'code 不能为空' })
  code!: string;

  @ApiPropertyOptional({
    description: '微信授权用户信息',
    example: { nickname: '张三', avatarUrl: 'https://...' },
  })
  @IsOptional()
  @IsObject()
  userInfo?: WxUserInfo;

  @ApiPropertyOptional({ description: '设备指纹（同一设备最多 3 账号）', example: 'device-fp-xxx' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceFp?: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Refresh Token' })
  @IsString()
  @IsNotEmpty({ message: 'refreshToken 不能为空' })
  refreshToken!: string;
}
