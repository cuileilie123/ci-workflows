import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
}
