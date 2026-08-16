import { PartialType } from '@nestjs/swagger';
import { CreateProfitSharingRuleDto } from './create-profit-sharing-rule.dto';

export class UpdateProfitSharingRuleDto extends PartialType(CreateProfitSharingRuleDto) {}
