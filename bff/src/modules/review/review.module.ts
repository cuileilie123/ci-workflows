import { Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { CreditService } from './credit.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, CreditService, PrismaService],
  exports: [ReviewService, CreditService],
})
export class ReviewModule {}
