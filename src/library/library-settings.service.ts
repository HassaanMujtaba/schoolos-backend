import { Injectable } from '@nestjs/common';
import { LibrarySettings } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { LibrarySettingsDto } from './dto/settings.dto';
import { LibrarySettingsResponseDto } from './dto/library-response.dto';

/**
 * `modules/library.md` "Open questions: Fine rate", resolved — a single per-tenant settings
 * document (`GET/PATCH /library/settings`), lazily created on first read/write the same way
 * `SchoolsService`'s own singleton row is (`certificates.module.ts`'s own doc comment references
 * this same pattern).
 */
@Injectable()
export class LibrarySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async get(): Promise<LibrarySettingsResponseDto> {
    return toResponse(await this.getOrCreate());
  }

  async update(dto: LibrarySettingsDto): Promise<LibrarySettingsResponseDto> {
    await this.getOrCreate();
    const tenantId = this.requireTenantId();
    const settings = await this.prisma.librarySettings.update({
      where: { tenantId },
      data: {
        finePerDayRate: dto.finePerDayRate,
        maxFine: dto.maxFine ?? null,
      },
    });
    return toResponse(settings);
  }

  /** Real `LibrarySettings` row, for `LibraryCirculationService`'s fine calculation. */
  async getEntity(): Promise<LibrarySettings> {
    return this.getOrCreate();
  }

  private async getOrCreate(): Promise<LibrarySettings> {
    const tenantId = this.requireTenantId();
    const existing = await this.prisma.librarySettings.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;
    return this.prisma.librarySettings.create({ data: { tenantId } });
  }

  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'LibrarySettingsService called with no tenant in request context',
      );
    }
    return tenantId;
  }
}

function toResponse(settings: LibrarySettings): LibrarySettingsResponseDto {
  return { finePerDayRate: settings.finePerDayRate, maxFine: settings.maxFine };
}
