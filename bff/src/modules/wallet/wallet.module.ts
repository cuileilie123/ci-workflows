import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WxPayUtil } from '../payment/wx-pay.util';
import { PrismaService } from '../../prisma/prisma.service';
import { VerificationModule } from '../verification/verification.module';

@Module({
  imports: [VerificationModule],
  controllers: [WalletController],
  providers: [WalletService, WxPayUtil, PrismaService],
  exports: [WalletService],
})
export class WalletModule {}
