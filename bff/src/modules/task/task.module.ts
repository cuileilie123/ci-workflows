import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { SearchModule } from '../search/search.module';
import { VerificationModule } from '../verification/verification.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

/**
 * 任务模块。
 * - PrismaService 由 UserModule 导出
 * - RedisService / SensitiveService 由全局 CommonModule 提供
 * - SearchModule 用于 ES 同步
 * - VerificationModule 用于发布/接单前置认证校验
 */
@Module({
  imports: [UserModule, SearchModule, VerificationModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
