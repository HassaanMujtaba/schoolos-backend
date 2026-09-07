import { SetMetadata } from '@nestjs/common';

export const ANY_PERMISSIONS_KEY = 'requiredAnyPermissions';

/**
 * The OR counterpart to `@RequirePermission` (that decorator's own doc comment: "use two separate
 * calls to a service, or a custom guard, for an OR requirement") — gates a route on holding *any
 * one* of the listed permissions, for an endpoint whose payload determines which specific
 * permission actually applies (e.g. `PATCH /admissions/:id/decision` needs `admissions.approve`
 * for an accept/waitlist decision or `admissions.reject` for a reject, but either caller may hit
 * the same route). `AnyPermissionsGuard` reads this metadata; the handler/service still must do
 * the payload-specific check itself (which exact permission does *this* request's decision value
 * require) — this guard only stops a caller with *neither* permission at all.
 */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
