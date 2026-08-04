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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ReviewService } from './review.service';
import { CreateReviewDto, QueryReviewDto } from './dto/review.dto';

@ApiTags('评价')
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  private userId(req: Request): string {
    return (req as unknown as { user: { sub: string } }).user.sub;
  }

  // ---- 1. 提交评价 ----
  @ApiOperation({ summary: '提交评价' })
  @ApiBearerAuth()
  @ApiBody({ type: CreateReviewDto })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(200)
  createReview(@Body() dto: CreateReviewDto, @Req() req: Request) {
    return this.reviewService.createReview(this.userId(req), dto);
  }

  // ---- 2. 查看订单评价 ----
  @ApiOperation({ summary: '查看订单评价' })
  @Get('order/:orderId')
  getOrderReview(@Param('orderId') orderId: string) {
    return this.reviewService.getOrderReview(orderId);
  }

  // ---- 3. 用户全部评价 ----
  @ApiOperation({ summary: '获取用户全部评价' })
  @Get('user/:userId')
  getUserReviews(@Param('userId') userId: string, @Query() query: QueryReviewDto) {
    return this.reviewService.getUserReviews(userId, query);
  }

  // ---- 4. 用户信用分详情 ----
  @ApiOperation({ summary: '获取用户信用分详情' })
  @Get('credit/:userId')
  getCredit(@Param('userId') userId: string) {
    return this.reviewService.getCredit(userId);
  }
}
