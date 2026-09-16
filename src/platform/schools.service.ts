import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../common/pagination/paginate';
import { AuthService } from '../auth/auth.service';
import { unusablePasswordHash } from '../auth/utils/unusable-password';
import { lowerEnum, slugSuffix, slugify, upperEnum } from './platform.mappers';
import { BillingService } from './billing.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { addOneMonthPkt, startOfTodayPkt } from '../common/dates/pkt-time';
import {
  ListSchoolsQueryDto,
  SchoolDetailResponseDto,
  SchoolOnboardingDto,
  SchoolResponseDto,
  UpdateSchoolStatusDto,
} from './dto/school.dto';

const SORTABLE_FIELDS = ['name', 'createdAt'] as const;

const SCHOOL_INCLUDE = {
  school: true,
  subscription: true,
  branches: { select: { id: true, name: true } },
  _count: {
    select: {
      branches: true,
      users: true,
      students: { where: { status: 'active' } },
    },
  },
} satisfies Prisma.TenantInclude;

type TenantWithSchool = Prisma.TenantGetPayload<{
  include: typeof SCHOOL_INCLUDE;
}>;

/**
 * `GET/POST/PATCH /platform/schools` — `modules/platform-console.md` "Schools (tenant
 * management)". Reads/writes exclusively through `PlatformPrismaService`: every query here is
 * cross-tenant by design (`platform-prisma.service.ts`'s own doc comment). Queries from `Tenant`,
 * not `School`, so a tenant with no `School` row yet (there should never be one after this
 * service creates both together, but a hand-seeded test tenant might have only one) doesn't
 * silently 500 — see `toResponse`'s own guard.
 */
@Injectable()
export class SchoolsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auth: AuthService,
    private readonly auditLog: PlatformAuditLogService,
    private readonly billingRecords: BillingService,
  ) {}

  async list(
    query: ListSchoolsQueryDto,
  ): Promise<PagedResult<SchoolResponseDto>> {
    const where: Prisma.TenantWhereInput = {
      school: { isNot: null },
      ...(query.status ? { status: upperEnum(query.status) } : {}),
      ...(query.search
        ? {
            school: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'createdAt');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.platformPrisma.tenant.findMany({
          where,
          include: SCHOOL_INCLUDE,
          orderBy:
            sortBy === 'name'
              ? { school: { name: query.sortDir ?? 'asc' } }
              : { createdAt: query.sortDir ?? 'desc' },
          skip,
          take,
        }),
      () => this.platformPrisma.tenant.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(tenantId: string): Promise<SchoolDetailResponseDto> {
    const tenant = await this.findOrThrow(tenantId);
    return {
      ...toResponse(tenant),
      branches: tenant.branches,
    };
  }

  async create(dto: SchoolOnboardingDto): Promise<SchoolResponseDto> {
    const slug = await this.uniqueSlug(dto.name);
    const ownerRole = await this.platformPrisma.role.findUniqueOrThrow({
      where: { key: 'school_owner' },
    });
    const periodStart = startOfTodayPkt();
    const periodEnd = addOneMonthPkt(periodStart);

    const tenant = await this.platformPrisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { name: dto.name, slug, status: 'ACTIVE' },
      });
      await tx.school.create({
        data: { tenantId: created.id, name: dto.name, email: dto.contactEmail },
      });
      const subscription = await tx.subscription.create({
        data: {
          tenantId: created.id,
          monthlyAmount: dto.monthlyAmount,
          status: 'ACTIVE',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      });
      const owner = await tx.user.create({
        data: {
          tenantId: created.id,
          email: dto.contactEmail,
          name: `${dto.name} Owner`,
          passwordHash: unusablePasswordHash(),
          status: 'INVITED',
        },
      });
      await tx.userRole.create({
        data: { tenantId: created.id, userId: owner.id, roleId: ownerRole.id },
      });
      return {
        tenantId: created.id,
        ownerId: owner.id,
        ownerEmail: owner.email,
        ownerName: owner.name,
        subscriptionId: subscription.id,
      };
    });

    // Outside the transaction — Redis + SMTP, not Postgres (same "don't hold a DB transaction open
    // across an unrelated I/O call" reasoning `certificates.service.ts`'s storage upload follows).
    await this.auth.issueInviteToken(
      tenant.ownerId,
      tenant.ownerEmail,
      tenant.ownerName,
    );
    await this.billingRecords.createPendingRecord({
      tenantId: tenant.tenantId,
      subscriptionId: tenant.subscriptionId,
      amount: dto.monthlyAmount,
      issuedAt: periodStart,
    });
    await this.auditLog.record({
      action: 'school.onboarded',
      target: dto.name,
      tenantId: tenant.tenantId,
      tenantName: dto.name,
    });

    return this.get(tenant.tenantId);
  }

  async updateStatus(
    tenantId: string,
    dto: UpdateSchoolStatusDto,
  ): Promise<SchoolResponseDto> {
    await this.findOrThrow(tenantId);
    const status = upperEnum<'ACTIVE' | 'SUSPENDED' | 'TRIAL'>(dto.status);
    const tenant = await this.platformPrisma.tenant.update({
      where: { id: tenantId },
      data: { status },
      include: SCHOOL_INCLUDE,
    });
    await this.auditLog.record({
      action: `school.status_changed:${dto.status}`,
      target: tenant.school?.name ?? tenant.name,
      tenantId,
      tenantName: tenant.school?.name ?? tenant.name,
    });
    return toResponse(tenant);
  }

  private async findOrThrow(tenantId: string): Promise<TenantWithSchool> {
    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { id: tenantId },
      include: SCHOOL_INCLUDE,
    });
    if (!tenant || !tenant.school) {
      throw new NotFoundException(`School ${tenantId} not found`);
    }
    return tenant;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    // Bounded, not `while (true)` — a name colliding on every one of a handful of random suffixes
    // in a row would mean something is badly wrong (or under test-seeded stress), and this should
    // fail loudly rather than loop forever.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.platformPrisma.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
      candidate = `${base}-${slugSuffix()}`;
    }
    throw new BadRequestException(
      'Could not generate a unique school identifier — try again',
    );
  }
}

function toResponse(tenant: TenantWithSchool): SchoolResponseDto {
  if (!tenant.school) {
    // Guarded by every call site's own `where`/`findOrThrow` — a tenant reaching here always has
    // a School row. Thrown rather than silently defaulted so a future call site that forgets that
    // guard fails loudly instead of returning garbage.
    throw new NotFoundException(`School ${tenant.id} not found`);
  }
  return {
    id: tenant.id,
    name: tenant.school.name,
    contactEmail: tenant.school.email,
    status: lowerEnum(tenant.status),
    monthlyAmount: tenant.subscription?.monthlyAmount ?? 0,
    branchCount: tenant._count.branches,
    userCount: tenant._count.users,
    studentCount: tenant._count.students,
    createdAt: tenant.createdAt.toISOString(),
  };
}
