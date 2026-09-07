import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContextService } from '../../common/context/request-context.service';
import {
  PagedResult,
  ListQueryDto,
} from '../../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../../common/dates/date-only';
import { AcademicYearDto } from './dto/academic-year.dto';
import { AcademicYearResponseDto } from './dto/academic-year-response.dto';

const SORTABLE_FIELDS = ['name', 'startDate', 'createdAt'] as const;

const ACADEMIC_YEAR_INCLUDE = {
  terms: { orderBy: { startDate: 'asc' } },
  holidays: { orderBy: { date: 'asc' } },
} satisfies Prisma.AcademicYearInclude;

type AcademicYearWithChildren = Prisma.AcademicYearGetPayload<{
  include: typeof ACADEMIC_YEAR_INCLUDE;
}>;

/**
 * `frontend/src/features/school-setup/api.ts`'s academic-years surface. Terms/holidays are
 * replaced wholesale on every write, same pattern as `BranchesService`'s buildings/departments —
 * see that class's own doc comment.
 */
@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async list(
    query: ListQueryDto,
  ): Promise<PagedResult<AcademicYearResponseDto>> {
    const where: Prisma.AcademicYearWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'startDate');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.academicYear.findMany({
          where,
          include: ACADEMIC_YEAR_INCLUDE,
          orderBy: { [sortBy]: query.sortDir ?? 'desc' },
          skip,
          take,
        }),
      () => this.prisma.academicYear.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<AcademicYearResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: AcademicYearDto): Promise<AcademicYearResponseDto> {
    assertDateRangesValid(dto);
    const tenantId = this.requireTenantId();
    const academicYear = await this.prisma.academicYear.create({
      // The top-level `tenantId` is injected by PrismaService's tenant-scoping extension at
      // runtime; the nested terms/holidays creates below need it set explicitly instead — see
      // `BranchesService`'s `requireTenantId` doc comment for why (the extension can't see into
      // a nested relation write).
      data: {
        name: dto.name,
        startDate: parseDateOnly(dto.startDate),
        endDate: parseDateOnly(dto.endDate),
        terms: {
          create: dto.terms.map((term) => ({
            ...toTermCreateInput(term),
            tenantId,
          })),
        },
        holidays: {
          create: dto.holidays.map((holiday) => ({
            ...toHolidayCreateInput(holiday),
            tenantId,
          })),
        },
      } as unknown as Prisma.AcademicYearUncheckedCreateInput,
      include: ACADEMIC_YEAR_INCLUDE,
    });
    return toResponse(academicYear);
  }

  async update(
    id: string,
    dto: AcademicYearDto,
  ): Promise<AcademicYearResponseDto> {
    assertDateRangesValid(dto);
    await this.findOrThrow(id);
    const tenantId = this.requireTenantId();

    const academicYear = await this.prisma.$transaction(async (tx) => {
      await tx.term.deleteMany({ where: { academicYearId: id } });
      await tx.holiday.deleteMany({ where: { academicYearId: id } });
      return tx.academicYear.update({
        where: { id },
        data: {
          name: dto.name,
          startDate: parseDateOnly(dto.startDate),
          endDate: parseDateOnly(dto.endDate),
          terms: {
            create: dto.terms.map((term) => ({
              ...toTermCreateInput(term),
              tenantId,
            })),
          },
          holidays: {
            create: dto.holidays.map((holiday) => ({
              ...toHolidayCreateInput(holiday),
              tenantId,
            })),
          },
        },
        include: ACADEMIC_YEAR_INCLUDE,
      });
    });

    return toResponse(academicYear);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.academicYear.delete({ where: { id } });
  }

  /** See `BranchesService.requireTenantId`'s doc comment — same reason, same fix. */
  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'AcademicYearsService called with no tenant in request context',
      );
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<AcademicYearWithChildren> {
    const academicYear = await this.prisma.academicYear.findUnique({
      where: { id },
      include: ACADEMIC_YEAR_INCLUDE,
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year ${id} not found`);
    }
    return academicYear;
  }
}

/**
 * Server-side enforcement of `schemas.ts`'s `.refine((year) => year.endDate >= year.startDate)` —
 * the frontend's own zod refinement is a UX nicety, this is the actual guarantee (cross-cutting
 * DoD: "DTO validation... drift here is the single most common source of a 'works in Postman,
 * breaks in the app' bug" — a `class-validator` cross-field check would need a custom decorator
 * for no real benefit over a plain service-level assertion).
 */
function assertDateRangesValid(dto: AcademicYearDto): void {
  if (dto.endDate < dto.startDate) {
    throw new BadRequestException(
      'End date must be on or after the start date',
    );
  }
  for (const term of dto.terms) {
    if (term.endDate < term.startDate) {
      throw new BadRequestException(
        `Term "${term.name}": end date must be on or after the start date`,
      );
    }
  }
}

function toTermCreateInput(term: AcademicYearDto['terms'][number]) {
  return {
    name: term.name,
    startDate: parseDateOnly(term.startDate),
    endDate: parseDateOnly(term.endDate),
  };
}

function toHolidayCreateInput(holiday: AcademicYearDto['holidays'][number]) {
  return { name: holiday.name, date: parseDateOnly(holiday.date) };
}

function toResponse(
  academicYear: AcademicYearWithChildren,
): AcademicYearResponseDto {
  const today = formatDateOnly(new Date());
  const startDate = formatDateOnly(academicYear.startDate);
  const endDate = formatDateOnly(academicYear.endDate);

  return {
    id: academicYear.id,
    name: academicYear.name,
    startDate,
    endDate,
    // See schema.prisma's own note on why this is computed, not a stored/toggled flag.
    isCurrent: startDate <= today && today <= endDate,
    terms: academicYear.terms.map((term) => ({
      id: term.id,
      name: term.name,
      startDate: formatDateOnly(term.startDate),
      endDate: formatDateOnly(term.endDate),
    })),
    holidays: academicYear.holidays.map((holiday) => ({
      id: holiday.id,
      name: holiday.name,
      date: formatDateOnly(holiday.date),
    })),
  };
}
