import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { PlatformUserResponseDto } from './dto/platform-user.dto';

const USER_INCLUDE = {
  tenant: { include: { school: true } },
  userRoles: { include: { role: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{
  include: typeof USER_INCLUDE;
}>;

/**
 * `GET /platform/users` — "cross-tenant user search — support/troubleshooting use case,
 * permission-gated tightly" (`platform-console.md`). Only ever returns *school* users
 * (`school: { isNot: null }`, same guard `SchoolsService` uses) — the Super Admin account itself
 * lives in a housekeeping tenant with no `School` row (`prisma/seed.ts`'s own comment on why), and
 * showing it here would be a confusing, meaningless search result for a "find this school's user"
 * support workflow.
 */
@Injectable()
export class PlatformUsersService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  async search(
    query: ListQueryDto,
  ): Promise<PagedResult<PlatformUserResponseDto>> {
    const where: Prisma.UserWhereInput = {
      tenant: { school: { isNot: null } },
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.platformPrisma.user.findMany({
          where,
          include: USER_INCLUDE,
          orderBy: { name: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.platformPrisma.user.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }
}

function toResponse(user: UserWithRelations): PlatformUserResponseDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    tenantId: user.tenantId,
    tenantName: user.tenant.school?.name ?? user.tenant.name,
    roles: user.userRoles.map((userRole) => userRole.role.key),
  };
}
