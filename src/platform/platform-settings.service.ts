import { Injectable } from '@nestjs/common';
import { PlatformSettings } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import {
  PlatformSettingsResponseDto,
  UpdatePlatformSettingsDto,
} from './dto/platform-settings.dto';

const SETTINGS_ID = 'singleton';

/**
 * `GET/PATCH /platform/settings` — one row, id `"singleton"` (`schema.prisma`'s own doc comment
 * on `PlatformSettings`). `get()` upserts a default row into existence on first read rather than
 * requiring `prisma:seed` to have run first — same "lazily created" posture `schools.service.ts`'s
 * own doc comment gives `School` for the same reason.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  async get(): Promise<PlatformSettingsResponseDto> {
    const settings = await this.platformPrisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
    return toResponse(settings);
  }

  /** Reads the current grace-period-days without the response-DTO wrapping — `SubscriptionSweepService`'s own call site. */
  async getGracePeriodDays(): Promise<number> {
    const settings = await this.platformPrisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
    return settings.subscriptionGracePeriodDays;
  }

  async update(
    dto: UpdatePlatformSettingsDto,
  ): Promise<PlatformSettingsResponseDto> {
    const settings = await this.platformPrisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      update: { ...dto },
      create: { id: SETTINGS_ID, ...dto },
    });
    await this.auditLog.record({
      action: `platform.settings_updated:grace_period_days=${settings.subscriptionGracePeriodDays}`,
      target: 'Platform settings',
    });
    return toResponse(settings);
  }
}

function toResponse(settings: PlatformSettings): PlatformSettingsResponseDto {
  return { subscriptionGracePeriodDays: settings.subscriptionGracePeriodDays };
}
