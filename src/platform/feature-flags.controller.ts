import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { FeatureFlagsService } from './feature-flags.service';
import {
  FeatureFlagResponseDto,
  UpdateFeatureFlagDto,
} from './dto/feature-flag.dto';

@ApiTags('platform')
@Controller('platform/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  @Get()
  @RequirePermission('platform.feature-flags.manage')
  list(): Promise<FeatureFlagResponseDto[]> {
    return this.featureFlags.list();
  }

  @Patch(':id')
  @RequirePermission('platform.feature-flags.manage')
  @SkipAudit()
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagResponseDto> {
    return this.featureFlags.update(id, dto);
  }
}
