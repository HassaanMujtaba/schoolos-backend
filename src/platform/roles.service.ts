import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import {
  PermissionResponseDto,
  RoleResponseDto,
  UpdateRolePermissionsDto,
} from './dto/role.dto';

const SUPER_ADMIN_ROLE_KEY = 'super_admin';
const PLATFORM_PERMISSION_PREFIX = 'platform.';

type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: { rolePermissions: { include: { permission: true } } };
}>;

/**
 * `platform/roles.controller.ts` — the RBAC management gap `prisma/seed.ts`'s own header comment
 * used to flag: a fixed `Role`/`Permission` catalog with no way to change which permissions a
 * role grants short of a migration or hand-editing the database. `Role` and `Permission` carry no
 * `tenantId` (see `schema.prisma`) — they're global across the whole platform by design, so this
 * lives alongside `feature-flags.service.ts`/`plans.service.ts`, not under a tenant-scoped module,
 * and reads/writes go through `PlatformPrismaService`, never the tenant-scoped `PrismaService`.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  async listPermissions(): Promise<PermissionResponseDto[]> {
    const permissions = await this.platformPrisma.permission.findMany({
      orderBy: { key: 'asc' },
    });
    return permissions.map((permission) => ({
      id: permission.id,
      key: permission.key,
      label: permission.label,
    }));
  }

  async listRoles(): Promise<RoleResponseDto[]> {
    const roles = await this.platformPrisma.role.findMany({
      orderBy: { label: 'asc' },
      include: { rolePermissions: { include: { permission: true } } },
    });
    return roles.map(toResponse);
  }

  /**
   * Replaces the role's entire permission set. Two guardrails a client-side checkbox list can't
   * be trusted to enforce itself (security-standards: "the client never decides authorization"):
   * `super_admin` is immutable (it must always have every permission, unconditionally — an admin
   * UI is exactly the kind of surface a mistaken or malicious edit could use to lock every
   * platform operator out at once), and no role other than `super_admin` may ever hold a
   * `platform.*` permission (every `platform/*.controller.ts` route gates purely on the
   * permission string, with no separate "is this actually platform staff" check — granting one to
   * a tenant role would hand every user holding that role full cross-tenant platform access).
   */
  async updatePermissions(
    id: string,
    dto: UpdateRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    const role = await this.platformPrisma.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    if (role.key === SUPER_ADMIN_ROLE_KEY) {
      throw new BadRequestException(
        "super_admin's permissions can't be changed — it always has every permission by design.",
      );
    }

    const requestedKeys = [...new Set(dto.permissionKeys)];
    const platformKeys = requestedKeys.filter((key) =>
      key.startsWith(PLATFORM_PERMISSION_PREFIX),
    );
    if (platformKeys.length > 0) {
      throw new BadRequestException(
        `platform.* permissions can only be held by super_admin, never by "${role.key}": ` +
          platformKeys.join(', '),
      );
    }

    const permissions = await this.platformPrisma.permission.findMany({
      where: { key: { in: requestedKeys } },
    });
    const foundKeys = new Set(permissions.map((permission) => permission.key));
    const unknownKeys = requestedKeys.filter((key) => !foundKeys.has(key));
    if (unknownKeys.length > 0) {
      throw new BadRequestException(
        `Unknown permission key(s): ${unknownKeys.join(', ')}`,
      );
    }

    await this.platformPrisma.$transaction([
      this.platformPrisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.platformPrisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: id,
          permissionId: permission.id,
        })),
      }),
    ]);

    await this.auditLog.record({
      action: 'role.permissions-updated',
      target: role.label,
    });

    const updated = await this.platformPrisma.role.findUniqueOrThrow({
      where: { id },
      include: { rolePermissions: { include: { permission: true } } },
    });
    return toResponse(updated);
  }
}

function toResponse(role: RoleWithPermissions): RoleResponseDto {
  return {
    id: role.id,
    key: role.key,
    label: role.label,
    isSystem: role.isSystem,
    permissionKeys: role.rolePermissions
      .map((rolePermission) => rolePermission.permission.key)
      .sort(),
  };
}
