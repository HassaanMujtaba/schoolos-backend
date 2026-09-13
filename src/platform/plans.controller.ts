import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { PlansService } from './plans.service';
import { CreatePlanDto, PlanDto, PlanResponseDto } from './dto/plan.dto';

/**
 * Every route here is `@SkipAudit()` — `AuditInterceptor` would otherwise log a "mutating request
 * with no tenant context" warning for every one of them (correctly: there genuinely is no single
 * tenant to scope a platform mutation to). `PlatformAuditLogService.record`, called from within
 * `PlansService` itself, is this module's real audit trail — see its own doc comment.
 */
@ApiTags('platform')
@Controller('platform/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @RequirePermission('platform.subscriptions.manage')
  list(): Promise<PlanResponseDto[]> {
    return this.plans.list();
  }

  @Post()
  @RequirePermission('platform.subscriptions.manage')
  @SkipAudit()
  create(@Body() dto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.plans.create(dto);
  }

  @Patch(':id')
  @RequirePermission('platform.subscriptions.manage')
  @SkipAudit()
  update(
    @Param('id') id: string,
    @Body() dto: PlanDto,
  ): Promise<PlanResponseDto> {
    return this.plans.update(id, dto);
  }
}
