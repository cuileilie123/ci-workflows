import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { EsService } from './es.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [SearchController],
  providers: [EsService, PrismaService],
  exports: [EsService],
})
export class SearchModule {}
