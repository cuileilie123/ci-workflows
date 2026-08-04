import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTaskDto } from './create-task.dto';

/**
 * 更新任务（仅发布者可调用，且任务须处于 OPEN 状态）。
 * 不允许改 lat/lng/geohash 之外的核心字段时，可按需收紧。
 */
export class UpdateTaskDto extends PartialType(OmitType(CreateTaskDto, ['lat', 'lng'] as const)) {}
