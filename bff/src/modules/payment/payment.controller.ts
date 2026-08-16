import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PaymentService } from './payment.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { RefundDto } from './dto/refund.dto';

@ApiTags('支付')
@Controller('pay')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  private userId(req: Request): string {
    return (req as unknown as { user: { sub: string } }).user.sub;
  }

  // ---- 1. 创建支付订单 ----
  @ApiOperation({ summary: '创建支付订单' })
  @ApiBearerAuth()
  @ApiBody({ type: CreateOrderDto })
  @UseGuards(JwtAuthGuard)
  @Post('create-order')
  @HttpCode(200)
  createOrder(@Body() dto: CreateOrderDto, @Req() req: Request) {
    return this.paymentService.createOrder(this.userId(req), dto);
  }

  // ---- 1b. 补差订单支付（改价后发布者支付差额） ----
  @ApiOperation({ summary: '补差订单支付（改价后发布者支付差额）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('pay-supplement/:taskId')
  @HttpCode(200)
  paySupplement(@Param('taskId') taskId: string, @Req() req: Request) {
    return this.paymentService.createSupplementOrder(this.userId(req), taskId);
  }

  // ---- 2. 微信支付回调（公网可访问，不需要 JWT） ----
  @ApiOperation({ summary: '微信支付回调' })
  @Post('notify')
  @HttpCode(200)
  handleNotify(
    @Headers('wechatpay-timestamp') timestamp: string,
    @Headers('wechatpay-nonce') nonce: string,
    @Headers('wechatpay-signature') signature: string,
    @Body() body: unknown,
  ) {
    return this.paymentService.handleNotify(timestamp, nonce, signature, body);
  }

  // ---- 3. 查询订单状态 ----
  @ApiOperation({ summary: '查询订单状态' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('query/:orderId')
  queryOrder(@Param('orderId') orderId: string) {
    return this.paymentService.queryOrder(orderId);
  }

  // ---- 3a. 查询用户订单列表 ----
  @ApiOperation({ summary: '查询用户订单列表' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('user-orders')
  getUserOrders(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: Request,
  ) {
    return this.paymentService.getUserOrders(
      this.userId(req),
      status,
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }

  // ---- 3b. 取消待支付订单 ----
  @ApiOperation({ summary: '取消待支付订单' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('cancel/:orderId')
  @HttpCode(200)
  cancelOrder(@Param('orderId') orderId: string, @Req() req: Request) {
    return this.paymentService.cancelOrder(this.userId(req), orderId);
  }

  // ---- 4. 申请退款 ----
  @ApiOperation({ summary: '申请退款' })
  @ApiBearerAuth()
  @ApiBody({ type: RefundDto })
  @UseGuards(JwtAuthGuard)
  @Post('refund')
  @HttpCode(200)
  refund(@Body() dto: RefundDto, @Req() req: Request) {
    return this.paymentService.refund(this.userId(req), dto);
  }

  // ---- 4b. 申请退款（24h内原路退回） ----
  @ApiOperation({ summary: '申请退款（24h内原路退回到微信钱包/银行卡）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('request-refund/:orderId')
  @HttpCode(200)
  requestRefund(
    @Param('orderId') orderId: string,
    @Body('reason') reason: string | undefined,
    @Req() req: Request,
  ) {
    return this.paymentService.requestRefund(this.userId(req), orderId, reason);
  }

  // ---- 4c. 查询退款状态 ----
  @ApiOperation({ summary: '查询退款状态' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('refund-status/:orderId')
  getRefundStatus(@Param('orderId') orderId: string, @Req() req: Request) {
    return this.paymentService.getRefundStatus(this.userId(req), orderId);
  }

  // ---- 5. 管理后台：按订单号搜索 ----
  @ApiOperation({ summary: '管理后台：按订单号搜索订单（2大写字母+8数字）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('search-by-no/:orderNo')
  async findByOrderNo(@Param('orderNo') orderNo: string) {
    const result = await this.paymentService.findByOrderNo(orderNo);
    if (!result) {
      return { found: false, order: null };
    }
    return { found: true, order: result };
  }
}
