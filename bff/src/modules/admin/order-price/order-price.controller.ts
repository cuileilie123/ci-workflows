import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard, RequirePermissions } from '../../../auth/guards/permission.guard';
import { PERMISSIONS } from '../../../auth/permissions';
import { OrderPriceService } from './order-price.service';
import { CreatePriceModificationDto } from './dto/create-price-modification.dto';

type AuthRequest = Request & { user: { sub: string; role: string } };

/**
 * 工作人员/老板端：订单改价管理
 */
@ApiTags('平台-订单改价（工作人员/老板）')
@Controller('admin/order-price')
@UseGuards(PermissionGuard)
@RequirePermissions(PERMISSIONS.ORDER_PRICE_MANAGE)
@ApiBearerAuth()
export class OrderPriceController {
  constructor(private readonly orderPriceService: OrderPriceService) {}

  @ApiOperation({ summary: '查询可改价的已发布未完成任务列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @Get('tasks')
  findIncompleteTasks(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.orderPriceService.findIncompleteTasks(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @ApiOperation({ summary: '工作人员发起改价（打回发布者确认）' })
  @ApiBody({ type: CreatePriceModificationDto })
  @Post('tasks/:taskId/price-modification')
  @HttpCode(200)
  createPriceModification(
    @Param('taskId') taskId: string,
    @Body() dto: CreatePriceModificationDto,
    @Req() req: AuthRequest,
    @Ip() ip: string,
  ) {
    return this.orderPriceService.createPriceModification(req.user.sub, taskId, dto, ip);
  }
}

/**
 * 发布者端：确认/拒绝改价
 */
@ApiTags('用户-订单改价确认（发布者）')
@Controller('tasks')
@UseGuards(PermissionGuard)
@ApiBearerAuth()
export class TaskPriceConfirmController {
  constructor(private readonly orderPriceService: OrderPriceService) {}

  @ApiOperation({ summary: '查询我待确认的改价单' })
  @Get('price-changes/pending')
  findMyPending(@Req() req: AuthRequest) {
    return this.orderPriceService.findMyPendingPriceChanges(req.user.sub);
  }

  @ApiOperation({ summary: '发布者确认改价（结算差额后回到待接单）' })
  @Post(':id/confirm-price-change')
  @HttpCode(200)
  confirmPriceChange(@Param('id') id: string, @Req() req: AuthRequest, @Ip() ip: string) {
    return this.orderPriceService.confirmPriceChange(req.user.sub, id, ip);
  }

  @ApiOperation({ summary: '发布者拒绝改价（恢复原状态）' })
  @Post(':id/reject-price-change')
  @HttpCode(200)
  rejectPriceChange(@Param('id') id: string, @Req() req: AuthRequest, @Ip() ip: string) {
    return this.orderPriceService.rejectPriceChange(req.user.sub, id, ip);
  }
}
