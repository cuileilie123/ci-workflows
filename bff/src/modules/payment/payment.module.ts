import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { WxPayUtil } from './wx-pay.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [ScheduleModule.forRoot(), AdminModule],
  controllers: [PaymentController],
  providers: [PaymentService, WxPayUtil, PrismaService],
  exports: [PaymentService],
})
export class PaymentModule {}
