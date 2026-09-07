import { Injectable, NotFoundException } from '@nestjs/common';
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
import { BranchDto } from './dto/branch.dto';
import { BranchResponseDto } from './dto/branch-response.dto';

const SORTABLE_FIELDS = ['name', 'campus', 'createdAt'] as const;

const BRANCH_INCLUDE = {
  buildings: { orderBy: { name: 'asc' } },
  departments: { orderBy: { name: 'asc' } },
} satisfies Prisma.BranchInclude;

type BranchWithChildren = Prisma.BranchGetPayload<{
  include: typeof BRANCH_INCLUDE;
}>;

/**
 * `frontend/src/features/school-setup/api.ts`'s branches surface. Buildings/departments are
 * replaced wholesale on every create/update (delete-then-recreate inside the same transaction),
 * matching the semantics of a `useFieldArray`-submitted full list rather than diffing individual
 * rows — see `schema.prisma`'s `Branch` doc comment for why they're still real child tables
 * underneath that array-shaped contract.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async list(query: ListQueryDto): Promise<PagedResult<BranchResponseDto>> {
    const where: Prisma.BranchWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { campus: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.branch.findMany({
          where,
          include: BRANCH_INCLUDE,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.branch.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<BranchResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: BranchDto): Promise<BranchResponseDto> {
    const tenantId = this.requireTenantId();
    const branch = await this.prisma.branch.create({
      // The top-level `tenantId` is injected by PrismaService's tenant-scoping extension at
      // runtime (see `requireTenantId`'s own doc comment for why the *nested* buildings/
      // departments creates below can't rely on that same mechanism and set it explicitly
      // instead). TypeScript can't see the top-level rewrite, so the input type requires a field
      // this object doesn't have; cast at this one boundary, same pattern `audit.interceptor.ts`
      // already uses for `AuditLog.create`.
      data: {
        name: dto.name,
        campus: dto.campus,
        address: dto.address,
        buildings: {
          create: dto.buildings.map((b) => ({ name: b.name, tenantId })),
        },
        departments: {
          create: dto.departments.map((d) => ({ name: d.name, tenantId })),
        },
      } as unknown as Prisma.BranchUncheckedCreateInput,
      include: BRANCH_INCLUDE,
    });
    return toResponse(branch);
  }

  async update(id: string, dto: BranchDto): Promise<BranchResponseDto> {
    await this.findOrThrow(id);
    const tenantId = this.requireTenantId();

    const branch = await this.prisma.$transaction(async (tx) => {
      await tx.building.deleteMany({ where: { branchId: id } });
      await tx.department.deleteMany({ where: { branchId: id } });
      return tx.branch.update({
        where: { id },
        data: {
          name: dto.name,
          campus: dto.campus,
          address: dto.address,
          buildings: {
            create: dto.buildings.map((b) => ({ name: b.name, tenantId })),
          },
          departments: {
            create: dto.departments.map((d) => ({ name: d.name, tenantId })),
          },
        },
        include: BRANCH_INCLUDE,
      });
    });

    return toResponse(branch);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.branch.delete({ where: { id } });
  }

  /**
   * PrismaService's tenant-scoping extension (`tenant-scoping.ts`) only sees the top-level
   * `model`/`operation` of a client call — it stamps `tenantId` onto `branch.create`'s own `data`
   * object, but has no visibility into `data.buildings.create`'s nested payload, which reaches
   * Postgres as its own insert with no `tenantId` at all. `Building`/`Department` have a required
   * `tenantId` column, so this fails loudly (found writing this service's e2e test) rather than
   * silently creating unscoped rows — but it does mean nested writes need this explicit stamp,
   * every top-level tenant-scoped `create`/`update` doesn't.
   */
  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'BranchesService called with no tenant in request context',
      );
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<BranchWithChildren> {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: BRANCH_INCLUDE,
    });
    if (!branch) {
      throw new NotFoundException(`Branch ${id} not found`);
    }
    return branch;
  }
}

function toResponse(branch: BranchWithChildren): BranchResponseDto {
  return {
    id: branch.id,
    name: branch.name,
    campus: branch.campus ?? '',
    address: branch.address ?? '',
    buildings: branch.buildings.map((b) => ({ id: b.id, name: b.name })),
    departments: branch.departments.map((d) => ({ id: d.id, name: d.name })),
  };
}
