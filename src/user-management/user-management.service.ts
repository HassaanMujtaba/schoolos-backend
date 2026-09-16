import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { AuthService } from '../auth/auth.service';
import { unusablePasswordHash } from '../auth/utils/unusable-password';
import {
  ASSIGNABLE_ROLE_KEYS,
  AssignableRoleDto,
  CreateUserDto,
  UpdateUserRolesDto,
  UpdateUserStatusDto,
  UserResponseDto,
} from './dto/user.dto';

const USER_INCLUDE = {
  userRoles: { include: { role: true } },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/**
 * `GET/POST/PATCH /users` — a School Owner/Admin creating and managing staff accounts within
 * their own tenant. Tenant-scoped throughout (`PrismaService`, never `PlatformPrismaService` —
 * this is deliberately *not* the cross-tenant `platform/platform-users.service.ts` search).
 * Mutations here are audited automatically by the generic `AuditInterceptor` (`common/
 * interceptors/audit.interceptor.ts`) — no manual audit-log calls needed, unlike `platform/`'s own
 * services (which run outside any single tenant's context, so that interceptor can't reach them).
 */
@Injectable()
export class UserManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(query: ListQueryDto): Promise<PagedResult<UserResponseDto>> {
    const where: Prisma.UserWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.user.findMany({
          where,
          include: USER_INCLUDE,
          orderBy: { name: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.user.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<UserResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const roles = await this.resolveRoles(dto.roleKeys);

    let user: UserWithRoles;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            passwordHash: unusablePasswordHash(),
            status: 'INVITED',
          } as unknown as Prisma.UserUncheckedCreateInput,
        });
        await tx.userRole.createMany({
          data: roles.map((role) => ({
            userId: created.id,
            roleId: role.id,
          })) as unknown as Prisma.UserRoleUncheckedCreateInput[],
        });
        return tx.user.findUniqueOrThrow({
          where: { id: created.id },
          include: USER_INCLUDE,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A user with email "${dto.email}" already exists at this school`,
        );
      }
      throw error;
    }

    // Outside the transaction — SMTP, not Postgres (same "don't hold a DB transaction open across
    // an unrelated I/O call" reasoning `platform/schools.service.ts`'s own onboarding follows).
    await this.auth.issueInviteToken(user.id, user.email, user.name);

    return toResponse(user);
  }

  /** Replaces the user's entire role set — always the full checked list, never a diff, same contract `platform/roles.service.ts`'s `updatePermissions` documents for the analogous edit. */
  async updateRoles(
    id: string,
    dto: UpdateUserRolesDto,
  ): Promise<UserResponseDto> {
    await this.findOrThrow(id);
    const roles = await this.resolveRoles(dto.roleKeys);

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({
          userId: id,
          roleId: role.id,
        })) as unknown as Prisma.UserRoleUncheckedCreateInput[],
      }),
    ]);

    return this.get(id);
  }

  /** Suspending also kills every existing session (`AuthService.logoutAll`) — a suspended account should lose access immediately, not just fail its *next* login. */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
  ): Promise<UserResponseDto> {
    await this.findOrThrow(id);
    const status = dto.status === 'active' ? 'ACTIVE' : 'SUSPENDED';
    await this.prisma.user.update({ where: { id }, data: { status } });
    if (status === 'SUSPENDED') {
      await this.auth.logoutAll(id);
    }
    return this.get(id);
  }

  async listAssignableRoles(): Promise<AssignableRoleDto[]> {
    const roles = await this.prisma.role.findMany({
      where: { key: { in: [...ASSIGNABLE_ROLE_KEYS] } },
      orderBy: { label: 'asc' },
    });
    return roles.map((role) => ({ key: role.key, label: role.label }));
  }

  private async resolveRoles(
    roleKeys: string[],
  ): Promise<{ id: string; key: string }[]> {
    const roles = await this.prisma.role.findMany({
      where: { key: { in: roleKeys } },
    });
    const foundKeys = new Set(roles.map((role) => role.key));
    const missing = roleKeys.filter((key) => !foundKeys.has(key));
    if (missing.length > 0) {
      // Unreachable via the DTO's own `@IsIn(ASSIGNABLE_ROLE_KEYS)` once `prisma:seed` has run —
      // fails clearly rather than silently assigning fewer roles than requested if it somehow
      // hasn't (same "fail loudly, not deep in a service with a partial result" reasoning
      // `schools.service.ts`'s own plan-lookup guard used to give).
      throw new NotFoundException(
        `Role(s) not seeded — run prisma:seed: ${missing.join(', ')}`,
      );
    }
    return roles;
  }

  private async findOrThrow(id: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: USER_INCLUDE,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}

function toResponse(user: UserWithRoles): UserResponseDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status.toLowerCase() as UserResponseDto['status'],
    roles: user.userRoles.map((userRole) => userRole.role.key),
    createdAt: user.createdAt.toISOString(),
  };
}
