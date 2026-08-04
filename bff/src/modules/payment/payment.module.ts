import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { WxPayUtil } from './wx-pay.util';

@Module({
  controllers: [PaymentController],
  providers: [PaymentService, WxPayUtil],
  exports: [PaymentService],
})
export class PaymentModule {}
