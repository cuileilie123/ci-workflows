import { Controller, Post, Body, Logger } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { IsString, IsNumber, IsOptional } from 'class-validator';

class TrackEventDto {
  @IsString()
  event!: string;

  @IsOptional()
  props?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsNumber()
  timestamp!: number;

  @IsString()
  sessionId!: string;
}

class TrackBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  events!: TrackEventDto[];
}

@Controller('track')
export class TrackController {
  private readonly logger = new Logger(TrackController.name);

  constructor(private readonly redisService: RedisService) {}

  @Post()
  async receiveTrack(@Body() dto: TrackBatchDto) {
    // 批量写入（异步，不阻塞）
    // 这里可以将事件推送到消息队列供后续处理
    for (const event of dto.events) {
      // 存储到 Redis 进行实时统计
      const key = `metric:${event.event}:${new Date(event.timestamp).toISOString().slice(0, 13)}`;
      // 使用 SET 命令模拟 incr 操作
      const currentValue = await this.redisService.get(key);
      const newValue = currentValue ? parseInt(currentValue) + 1 : 1;
      await this.redisService.set(key, newValue.toString(), 86400); // 24小时过期

      // 可选：将事件存储到数据库或发送到消息队列
      this.logger.debug('Received track event: ' + JSON.stringify(event));
    }

    return { code: 0, message: 'ok', data: null };
  }
}
