import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { CreditService } from './credit.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [ReviewController],
  providers: [ReviewService, CreditService, PrismaService],
  exports: [ReviewService, CreditService],
})
export class ReviewModule {}
