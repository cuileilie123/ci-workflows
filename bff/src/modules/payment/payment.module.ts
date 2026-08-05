import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { WxPayUtil } from './wx-pay.util';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [PaymentController],
  providers: [PaymentService, WxPayUtil, PrismaService],
  exports: [PaymentService],
})
export class PaymentModule {}
