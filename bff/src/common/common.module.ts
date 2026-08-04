import { Global, Module } from '@nestjs/common';
import { TokenBlacklistService } from './token-blacklist.service';
import { SensitiveService } from './sensitive.service';
import { RedisService } from './redis.service';

/**
 * 全局公共模块：提供跨模块共享的单例服务。
 * 在 AppModule 中导入一次后，所有模块均可注入。
 */
@Global()
@Module({
  providers: [TokenBlacklistService, SensitiveService, RedisService],
  exports: [TokenBlacklistService, SensitiveService, RedisService],
})
export class CommonModule {}
