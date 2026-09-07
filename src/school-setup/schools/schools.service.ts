import { Injectable } from '@nestjs/common';
import { Prisma, School } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { SchoolProfileDto } from './dto/school.dto';
import { SchoolResponseDto } from './dto/school-response.dto';

/**
 * §6 School Profile — `GET/PATCH /schools/current` (`modules/school-setup.md`'s own "confirm with
 * backend" note, resolved: keep `/schools/current`, there's still nothing else in the session to
 * address a school by). Exactly one `School` row per tenant, lazily created on first access —
 * there is no tenant-provisioning flow before Phase 7.9's Platform Console, so a row can't be
 * guaranteed to exist by the time this endpoint is first called for a given tenant.
 */
@Injectable()
export class SchoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async getCurrent(): Promise<SchoolResponseDto> {
    return toResponse(await this.getOrCreate());
  }

  async updateCurrent(dto: SchoolProfileDto): Promise<SchoolResponseDto> {
    const current = await this.getOrCreate();
    const updated = await this.prisma.school.update({
      where: { id: current.id },
      data: dto,
    });
    return toResponse(updated);
  }

  private async getOrCreate(): Promise<School> {
    const existing = await this.prisma.school.findFirst();
    if (existing) {
      return existing;
    }

    const tenantId = this.requestContext.tenantId;
    // Not in TENANT_SCOPED_MODELS — Tenant defines what a tenant *is*, so this read runs
    // unscoped, same reasoning as schema.prisma's own comment on that model.
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({ where: { id: tenantId } })
      : null;

    try {
      // `tenantId` is injected by PrismaService's tenant-scoping extension at runtime — see
      // `BranchesService.create`'s identical comment.
      return await this.prisma.school.create({
        data: {
          name: tenant?.name ?? 'My School',
        } as unknown as Prisma.SchoolUncheckedCreateInput,
      });
    } catch (error) {
      // Two concurrent first-loads for the same tenant both see "no school yet" and both try to
      // create one — School.tenantId is @unique, so the loser gets a P2025/P2002 here rather than
      // a duplicate row. Re-fetch instead of failing the request; this is an admin config screen,
      // not a hot path, so losing a race and retrying once is the simple, correct answer.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const created = await this.prisma.school.findFirst();
        if (created) return created;
      }
      throw error;
    }
  }
}

function toResponse(school: School): SchoolResponseDto {
  return {
    id: school.id,
    name: school.name,
    email: school.email,
    phone: school.phone,
    website: school.website,
    address: school.address,
    registrationNumber: school.registrationNumber,
    taxInfo: school.taxInfo,
    schoolType: school.schoolType as SchoolResponseDto['schoolType'],
    timezone: school.timezone,
    currency: school.currency,
    language: school.language,
    logoUrl: school.logoUrl,
  };
}
