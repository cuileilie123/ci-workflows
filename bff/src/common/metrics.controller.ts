import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Prometheus 指标端点
 * 路由 /metrics 已在 main.ts 中排除全局前缀，直接访问 http://host:port/metrics
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async expose(): Promise<string> {
    return this.metrics.metrics();
  }
}
