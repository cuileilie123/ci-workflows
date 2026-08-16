import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { TaskModule } from './modules/task/task.module';
import { SearchModule } from './modules/search/search.module';
import { UploadModule } from './modules/upload/upload.module';
import { ChatModule } from './modules/chat/chat.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ReviewModule } from './modules/review/review.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { VerificationModule } from './modules/verification/verification.module';
import { TrackModule } from './modules/track/track.module';
import { CommonModule } from './common/common.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    // MongoDB（聊天消息存储，连接失败不阻塞应用启动）
    MongooseModule.forRoot(process.env.MONGO_URL || 'mongodb://localhost:27017/neighborhood_help', {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    }),
    // 全局公共服务（Token 黑名单 / 敏感词 / Redis）
    CommonModule,
    AuthModule,
    AdminModule, // 平台中端管理：任务类别 + 分账规则
    UserModule,
    TaskModule,
    SearchModule,
    UploadModule,
    ChatModule,
    PaymentModule,
    ReviewModule,
    WalletModule,
    VerificationModule,
    TrackModule,
  ],
  controllers: [AppController],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
