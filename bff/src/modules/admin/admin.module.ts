import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  TaskCategoryController,
  TaskCategoryViewController,
} from './task-category/task-category.controller';
import { TaskCategoryService } from './task-category/task-category.service';
import {
  ProfitSharingController,
  ProfitSharingViewController,
} from './profit-sharing/profit-sharing.controller';
import { ProfitSharingService } from './profit-sharing/profit-sharing.service';
import { PermissionModule } from './permission/permission.module';
import { OrderPriceModule } from './order-price/order-price.module';
import { FinanceSettingsModule } from './finance-settings/finance-settings.module';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 平台中端管理模块
 * - 任务类别管理（增删改查）
 * - 分账规则管理（增删改查 + 动态计算）
 * - 权限管理（老板给工作人员授权）→ PermissionModule
 * - 订单改价（工作人员修改未完成订单价格）→ OrderPriceModule
 * - 财务设置（老板配置平台佣金收款账号）→ FinanceSettingsModule
 * 权限：
 *   - 老板(BOSS)/超管(SUPER_ADMIN)/管理员(ADMIN) 拥有全部权限
 *   - 工作人员(STAFF) 需由老板显式授权后才能访问对应功能
 */
@Module({
  imports: [PermissionModule, OrderPriceModule, FinanceSettingsModule],
  controllers: [
    TaskCategoryController,
    TaskCategoryViewController,
    ProfitSharingController,
    ProfitSharingViewController,
  ],
  providers: [TaskCategoryService, ProfitSharingService, PrismaService, Reflector, PermissionGuard],
  exports: [
    TaskCategoryService,
    ProfitSharingService,
    PermissionGuard,
    FinanceSettingsModule,
  ],
})
export class AdminModule {}
