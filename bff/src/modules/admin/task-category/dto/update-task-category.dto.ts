import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTaskCategoryDto } from './create-task-category.dto';

export class UpdateTaskCategoryDto extends PartialType(
  OmitType(CreateTaskCategoryDto, ['code'] as const),
) {}
