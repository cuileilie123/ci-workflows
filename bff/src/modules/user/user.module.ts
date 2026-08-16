import { Module } from '@nestjs/common';
import { GdprController } from './gdpr.controller';
import { UserController } from './user.controller';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [GdprController, UserController],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class UserModule {}
