import { Module } from '@nestjs/common';
import { OrderPriceController, TaskPriceConfirmController } from './order-price.controller';
import { OrderPriceService } from './order-price.service';
import { ProfitSharingService } from '../profit-sharing/profit-sharing.service';
import { PermissionGuard } from '../../../auth/guards/permission.guard';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [OrderPriceController, TaskPriceConfirmController],
  providers: [OrderPriceService, ProfitSharingService, PrismaService, PermissionGuard],
  exports: [OrderPriceService],
})
export class OrderPriceModule {}
