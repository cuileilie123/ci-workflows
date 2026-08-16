import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  ParseBoolPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { PermissionGuard, RequirePermissions } from '../../../auth/guards/permission.guard';
import { PERMISSIONS } from '../../../auth/permissions';
import { TaskCategoryService } from './task-category.service';
import { CreateTaskCategoryDto } from './dto/create-task-category.dto';
import { UpdateTaskCategoryDto } from './dto/update-task-category.dto';

type AdminRequest = Request & { user: { sub: string | number; role: string } };

@ApiTags('平台-任务类别管理（工作人员/老板）')
@Controller('admin/task-categories')
@UseGuards(PermissionGuard)
@RequirePermissions(PERMISSIONS.TASK_CATEGORY_MANAGE)
@ApiBearerAuth()
export class TaskCategoryController {
  constructor(private readonly taskCategoryService: TaskCategoryService) {}

  private getAdminId(req: AdminRequest): string {
    return String(req.user.sub);
  }

  private getIp(req: AdminRequest): string | undefined {
    return req.ip;
  }

  @Post()
  @ApiOperation({ summary: '创建任务类别' })
  @HttpCode(200)
  create(@Body() dto: CreateTaskCategoryDto, @Req() req: AdminRequest) {
    return this.taskCategoryService.create(dto, this.getAdminId(req), this.getIp(req));
  }

  @Get()
  @ApiOperation({ summary: '任务类别列表（含已停用，供工作人员管理）' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: '是否包含已停用的类别',
  })
  findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ) {
    return this.taskCategoryService.findAll(includeInactive ?? false);
  }

  @Get(':id')
  @ApiOperation({ summary: '任务类别详情' })
  findOne(@Param('id') id: string) {
    return this.taskCategoryService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新任务类别' })
  update(@Param('id') id: string, @Body() dto: UpdateTaskCategoryDto, @Req() req: AdminRequest) {
    return this.taskCategoryService.update(id, dto, this.getAdminId(req), this.getIp(req));
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除任务类别' })
  @HttpCode(200)
  remove(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.taskCategoryService.remove(id, this.getAdminId(req), this.getIp(req));
  }
}

/**
 * 用户端只读视图：所有登录用户可查看启用的任务类别（发布任务时选择）。
 */
@ApiTags('用户-任务类别（只读）')
@Controller('task-categories')
@UseGuards(PermissionGuard)
@ApiBearerAuth()
export class TaskCategoryViewController {
  constructor(private readonly taskCategoryService: TaskCategoryService) {}

  @ApiOperation({ summary: '查看启用的任务类别（只读）' })
  @Get()
  findActive() {
    return this.taskCategoryService.findAll(false);
  }
}
