import { Injectable, NotFoundException } from '@nestjs/common';
import { FeatureFlag } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { lowerEnum } from './platform.mappers';
import { PlatformAuditLogService } from './platform-audit-log.service';
import {
  FeatureFlagResponseDto,
  UpdateFeatureFlagDto,
} from './dto/feature-flag.dto';

/**
 * `GET/PATCH /platform/feature-flags`. Unpaginated, matching `frontend/src/features/platform/
 * api.ts`'s `listFeatureFlags(): Promise<FeatureFlag[]>` exactly (no `ListParams` there, unlike
 * every other list endpoint in this module) — the catalog this returns is small and fixed by
 * `prisma/seed.ts`, not something a caller pages through.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  async list(): Promise<FeatureFlagResponseDto[]> {
    const flags = await this.platformPrisma.featureFlag.findMany({
      orderBy: [{ key: 'asc' }, { tenantName: 'asc' }],
    });
    return flags.map(toResponse);
  }

  async update(
    id: string,
    dto: UpdateFeatureFlagDto,
  ): Promise<FeatureFlagResponseDto> {
    const flag = await this.findOrThrow(id);
    const updated = await this.platformPrisma.featureFlag.update({
      where: { id },
      data: { enabled: dto.enabled },
    });
    await this.auditLog.record({
      action: `feature-flag.${dto.enabled ? 'enabled' : 'disabled'}:${flag.key}`,
      target: flag.label,
      tenantId: flag.tenantId,
      tenantName: flag.tenantName,
    });
    return toResponse(updated);
  }

  private async findOrThrow(id: string): Promise<FeatureFlag> {
    const flag = await this.platformPrisma.featureFlag.findUnique({
      where: { id },
    });
    if (!flag) {
      throw new NotFoundException(`Feature flag ${id} not found`);
    }
    return flag;
  }
}

function toResponse(flag: FeatureFlag): FeatureFlagResponseDto {
  return {
    id: flag.id,
    key: flag.key,
    label: flag.label,
    description: flag.description,
    scope: lowerEnum(flag.scope),
    tenantName: flag.tenantName ?? undefined,
    enabled: flag.enabled,
  };
}
