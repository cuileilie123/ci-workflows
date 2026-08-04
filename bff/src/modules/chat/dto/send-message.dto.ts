import { IsString, IsEnum, IsOptional, IsObject, MaxLength, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '../types/message.type';

export class SendMessageDto {
  @ApiProperty({ description: '接收方用户 ID', example: '10' })
  @IsString()
  @IsNotEmpty({ message: '接收方不能为空' })
  receiverId!: string;

  @ApiProperty({
    description: '消息类型',
    enum: MessageType,
    example: MessageType.TEXT,
  })
  @IsEnum(MessageType, { message: '消息类型不合法' })
  type!: MessageType;

  @ApiProperty({ description: '文本内容（TEXT 必填，最长 500 字）', example: '你好，任务还在吗？' })
  @IsString()
  @MaxLength(500, { message: '消息最多 500 字' })
  content!: string;

  @ApiPropertyOptional({
    description: '附加数据（图片 URL / 语音时长 / 位置坐标）',
    example: { url: '/uploads/chat/abc.jpg' },
  })
  @IsOptional()
  @IsObject()
  metadata?: {
    url?: string;
    duration?: number;
    lat?: number;
    lng?: number;
    address?: string;
  };

  @ApiPropertyOptional({ description: '客户端幂等键（防重复发送）', example: 'uuid-xxx' })
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
