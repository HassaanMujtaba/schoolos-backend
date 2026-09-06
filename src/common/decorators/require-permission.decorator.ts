import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Gates a route the same way `frontend/src/lib/permissions.ts`'s `RequirePermission` gates a
 * route or in-page action — same permission strings, PRD §4's `<module>.<action>` pattern (the
 * catalog is collected in `../../../implementation-plan.md`). `PermissionsGuard` reads this
 * metadata; passing more than one string means the caller needs *all* of them (AND, not OR) —
 * use two separate calls to a service, or a custom guard, for an OR requirement.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
