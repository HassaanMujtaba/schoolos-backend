import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { PlatformSettingsService } from './platform-settings.service';
import {
  PlatformSettingsResponseDto,
  UpdatePlatformSettingsDto,
} from './dto/platform-settings.dto';

/** `GET/PATCH /platform/settings` — reuses `platform.subscriptions.manage` (the grace period is subscription-lifecycle config, not a separate permission bucket). `@SkipAudit()`: `PlatformAuditLogService.record` is called explicitly inside `PlatformSettingsService.update`. */
@ApiTags('platform')
@Controller('platform/settings')
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @RequirePermission('platform.subscriptions.manage')
  get(): Promise<PlatformSettingsResponseDto> {
    return this.settings.get();
  }

  @Patch()
  @RequirePermission('platform.subscriptions.manage')
  @SkipAudit()
  update(
    @Body() dto: UpdatePlatformSettingsDto,
  ): Promise<PlatformSettingsResponseDto> {
    return this.settings.update(dto);
  }
}
