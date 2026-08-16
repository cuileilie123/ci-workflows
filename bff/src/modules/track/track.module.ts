import { Module } from '@nestjs/common';
import { TrackController } from './track.controller';
import { RedisService } from '../../common/redis.service';

@Module({
  controllers: [TrackController],
  providers: [RedisService],
})
export class TrackModule {}
