import { Module } from '@nestjs/common';
import { GdprController } from './gdpr.controller';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [GdprController],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class UserModule {}
