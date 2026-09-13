import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';

const AUTH_PROFILE_INCLUDE = {
  userRoles: {
    include: {
      role: {
        include: { rolePermissions: { include: { permission: true } } },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{
  include: typeof AUTH_PROFILE_INCLUDE;
}>;

/** Everything `auth/` needs about a user to issue tokens and drive the session/portal split. */
export interface UserAuthProfile {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  email: string;
  passwordHash: string;
  /** Role *keys* (e.g. `school_admin`, `parent`) — matches `frontend/src/features/auth/portal.ts`'s assumption and `prisma/seed.ts`'s catalog, not the human-readable `label`. */
  roles: string[];
  /** Flattened, deduplicated permission strings across every role the user holds. */
  permissions: string[];
}

/**
 * User lookups shared across the app. Phase 1 only needs the auth-profile shape below (used
 * exclusively by `auth/`, via `PlatformPrismaService` — see that class's own doc comment for why
 * these two specific reads run unscoped); a tenant-scoped CRUD surface for `users/` itself is a
 * later phase's concern (no frontend module depends on `/users` endpoints yet).
 */
@Injectable()
export class UsersService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  /**
   * Resolves a login `identifier` (email or phone) to candidate users, before any tenant is
   * known. `email`/`phone` are only unique *within* a tenant (`schema.prisma`'s
   * `@@unique([tenantId, email])`), not globally — the frontend's login form has no tenant/school
   * selector (`modules/auth.md` never mentions one), so in the rare case the same identifier
   * exists in more than one tenant this deliberately returns every candidate rather than guessing
   * one; `AuthService` treats anything other than exactly one match as "no such user" and fails
   * closed, never picks a tenant on the caller's behalf.
   */
  async findAuthCandidatesByIdentifier(
    identifier: string,
  ): Promise<UserAuthProfile[]> {
    const users = await this.platformPrisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ email: identifier }, { phone: identifier }],
      },
      include: AUTH_PROFILE_INCLUDE,
    });

    return users.map(toAuthProfile);
  }

  /** Re-syncs a known user's roles/permissions by id — used on refresh so a long-lived session's permission set never lags more than one access-token lifetime behind an RBAC change. */
  async findAuthProfileById(userId: string): Promise<UserAuthProfile | null> {
    const user = await this.platformPrisma.user.findUnique({
      where: { id: userId },
      include: AUTH_PROFILE_INCLUDE,
    });

    return user && user.status === 'ACTIVE' ? toAuthProfile(user) : null;
  }

  /**
   * Sets a new password and, as of Phase 7.9, also flips `status` to `ACTIVE` unconditionally.
   * Previously (Phase 1) this only ever ran for an already-`ACTIVE` account resetting a forgotten
   * password, so the extra write was a no-op; Phase 7.9's `POST /platform/schools` is the first
   * caller that creates a user as `INVITED` (no usable password yet), and this same
   * `POST /auth/reset-password` flow is how that account sets its first real password and becomes
   * able to log in at all — `AuthService.issueInviteToken` is what gets them a valid token for it,
   * since `forgotPassword`'s own lookup only resolves already-`ACTIVE` accounts.
   */
  async setPasswordAndActivate(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.platformPrisma.user.update({
      where: { id: userId },
      data: { passwordHash, status: 'ACTIVE' },
    });
  }
}

function toAuthProfile(user: UserWithRoles): UserAuthProfile {
  const permissions = new Set<string>();
  for (const userRole of user.userRoles) {
    for (const rolePermission of userRole.role.rolePermissions) {
      permissions.add(rolePermission.permission.key);
    }
  }

  return {
    id: user.id,
    tenantId: user.tenantId,
    branchId: user.branchId,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    roles: user.userRoles.map((userRole) => userRole.role.key),
    permissions: [...permissions],
  };
}
