import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TaskService } from './task.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';

@ApiTags('任务')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  /** 从 JWT payload 取用户 ID */
  private userId(req: Request): string {
    return (req as unknown as { user: { sub: string } }).user.sub;
  }

  // ---- 1. 发布任务 ----
  @ApiOperation({ summary: '发布任务' })
  @ApiBearerAuth()
  @ApiBody({ type: CreateTaskDto })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateTaskDto, @Req() req: Request) {
    return this.taskService.create(this.userId(req), dto);
  }

  // ---- 2. 附近任务列表 ----
  @ApiOperation({ summary: '附近任务列表（GeoHash + Redis 缓存）' })
  @Get('nearby')
  listNearby(@Query() query: QueryTaskDto) {
    return this.taskService.listNearby(query);
  }

  // ---- 2b. 根路由也指向附近任务列表 ----
  @ApiOperation({ summary: '附近任务列表（别名）' })
  @Get()
  listNearbyAlias(@Query() query: QueryTaskDto) {
    return this.taskService.listNearby(query);
  }

  // ---- 3. 关键词搜索（须在 :id 之前，否则被当作 id） ----
  @ApiOperation({ summary: '关键词搜索任务' })
  @Get('search')
  search(@Query('q') q: string, @Query('page') page?: string) {
    return this.taskService.search(q, page ? Number(page) : 1);
  }

  // ---- 3b. 我的发布任务列表 ----
  @ApiOperation({ summary: '我的发布任务列表' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('my')
  myTasks(@Query('status') status?: string, @Query('page') page?: string, @Req() req?: Request) {
    return this.taskService.myTasks(this.userId(req!), {
      status,
      page: page ? Number(page) : 1,
    });
  }

  // ---- 4. 任务详情 ----
  @ApiOperation({ summary: '任务详情' })
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.taskService.findOne(String(id));
  }

  // ---- 5. 更新任务（仅发布者） ----
  @ApiOperation({ summary: '更新任务（仅发布者）' })
  @ApiBearerAuth()
  @ApiBody({ type: UpdateTaskDto })
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Req() req: Request) {
    return this.taskService.update(this.userId(req), id, dto);
  }

  // ---- 6. 取消任务（仅发布者） ----
  @ApiOperation({ summary: '取消任务（仅发布者）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Req() req: Request) {
    return this.taskService.cancel(this.userId(req), id);
  }

  // ---- 7. 报价接单 ----
  @ApiOperation({ summary: '报价接单' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id') id: string, @Req() req: Request) {
    return this.taskService.accept(this.userId(req), id);
  }

  // ---- 7b. 发布者确认接单人 ----
  @ApiOperation({ summary: '发布者确认接单人' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm-bid/:orderId')
  @HttpCode(200)
  confirmBid(@Param('id') taskId: string, @Param('orderId') orderId: string, @Req() req: Request) {
    return this.taskService.confirmBid(this.userId(req), taskId, orderId);
  }

  // ---- 7c. 发布者拒绝报价 ----
  @ApiOperation({ summary: '发布者拒绝报价' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/reject-bid/:orderId')
  @HttpCode(200)
  rejectBid(@Param('id') taskId: string, @Param('orderId') orderId: string, @Req() req: Request) {
    return this.taskService.rejectBid(this.userId(req), taskId, orderId);
  }

  // ---- 8. 开始服务 ----
  @ApiOperation({ summary: '开始服务（接单者）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/start')
  @HttpCode(200)
  start(@Param('id') id: string, @Req() req: Request) {
    return this.taskService.start(this.userId(req), id);
  }

  // ---- 9. 确认完成 ----
  @ApiOperation({ summary: '确认完成（发布者）' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id') id: string, @Req() req: Request) {
    return this.taskService.complete(this.userId(req), id);
  }
}
