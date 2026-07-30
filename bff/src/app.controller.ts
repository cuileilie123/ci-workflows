import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

interface HealthResponse {
  status: string;
  uptime: number;
  timestamp: string;
}

@ApiTags('系统')
@Controller('health')
export class AppController {
  @ApiOperation({ summary: '健康检查' })
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
