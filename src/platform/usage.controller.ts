import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { UsageService } from './usage.service';
import { PlatformUsageResponseDto } from './dto/usage.dto';

/** No narrower `platform.*` permission covers the dashboard specifically (`platform-console.md`'s header: "Gated behind `platform.schools.manage` as the baseline Super Admin permission") — same baseline every Super Admin necessarily holds to see the console at all. */
@ApiTags('platform')
@Controller('platform/usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @RequirePermission('platform.schools.manage')
  get(): Promise<PlatformUsageResponseDto> {
    return this.usage.get();
  }
}
