import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { CreditService } from './credit.service';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, CreditService],
  exports: [ReviewService, CreditService],
})
export class ReviewModule {}
