import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { EsService } from './es.service';
import { SearchQueryDto, SuggestQueryDto } from './dto/search.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('搜索')
@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly esService: EsService) {}

  @Get()
  @ApiOperation({ summary: '搜索任务' })
  @ApiQuery({ name: 'q', required: false, description: '搜索关键词' })
  @ApiQuery({
    name: 'categoryCode',
    required: false,
    description: '任务类别编码（如 DELIVERY, CLEANING）',
  })
  @ApiQuery({ name: 'minPrice', required: false, description: '最低价格' })
  @ApiQuery({ name: 'maxPrice', required: false, description: '最高价格' })
  @ApiQuery({ name: 'lng', required: false, description: '经度' })
  @ApiQuery({ name: 'lat', required: false, description: '纬度' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'size', required: false, description: '每页数量' })
  async search(@Query() params: SearchQueryDto) {
    this.logger.log(`Search: ${params.q || '(empty)'}, category: ${params.categoryCode}`);

    const startTime = Date.now();
    let result;
    try {
      result = await this.esService.search({
        query: params.q || '',
        category: params.categoryCode,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        lng: params.lng,
        lat: params.lat,
        page: params.page,
        size: params.size,
      });
    } catch (error: unknown) {
      this.logger.error(`Search controller error: ${(error as Error).message}`);
      result = {
        items: [],
        total: 0,
        aggregations: { by_category: [], price_stats: { min: 0, max: 0, avg: 0 } },
      };
    }
    const duration = Date.now() - startTime;

    this.logger.log(`Search completed in ${duration}ms, total: ${result.total}`);

    return {
      ...result,
      duration,
    };
  }

  @Get('suggest')
  @ApiOperation({ summary: '搜索建议' })
  @ApiQuery({ name: 'q', required: true, description: '搜索前缀' })
  async suggest(@Query() params: SuggestQueryDto) {
    let suggestions: string[] = [];
    try {
      suggestions = await this.esService.suggest(params.q);
    } catch (error: unknown) {
      this.logger.error(`Suggest controller error: ${(error as Error).message}`);
      suggestions = [];
    }
    return suggestions;
  }

  @Get('sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '同步所有任务到 ES（管理员）' })
  async syncAll() {
    return {
      message: 'Sync initiated',
    };
  }
}
