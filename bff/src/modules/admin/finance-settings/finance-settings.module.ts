import { Module } from '@nestjs/common';
import { FinanceSettingsController } from './finance-settings.controller';
import { FinanceSettingsService } from './finance-settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminGuard } from '../../../auth/guards/admin.guard';
import { Reflector } from '@nestjs/core';

@Module({
  controllers: [FinanceSettingsController],
  providers: [FinanceSettingsService, PrismaService, AdminGuard, Reflector],
  exports: [FinanceSettingsService],
})
export class FinanceSettingsModule {}
