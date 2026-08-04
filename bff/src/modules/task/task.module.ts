import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

/**
 * 任务模块。
 * - PrismaService 由 UserModule 导出
 * - RedisService / SensitiveService 由全局 CommonModule 提供
 */
@Module({
  imports: [UserModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
