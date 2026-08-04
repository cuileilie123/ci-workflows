import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WxPayUtil } from '../payment/wx-pay.util';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, WxPayUtil, PrismaService],
  exports: [WalletService],
})
export class WalletModule {}
