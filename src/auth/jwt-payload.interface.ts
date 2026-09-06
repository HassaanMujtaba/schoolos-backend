/**
 * Access-token claims. Deliberately carries the resolved `roles`/`permissions` (not just a
 * `userId` to look up on every request) so `JwtAuthGuard`/`JwtStrategy` never hit the database —
 * PRD §52's pipeline step "Permission Check" reads straight off the verified token. The trade-off
 * (permissions can lag an RBAC change by up to one access-token lifetime, ~`JWT_ACCESS_TTL`) is
 * bounded by that short TTL and re-synced from the DB on every refresh (`auth.service.ts`).
 */
export interface AccessTokenPayload {
  /** Subject — the user id. Standard JWT claim name, read by `@nestjs/jwt`/passport-jwt. */
  sub: string;
  tenantId: string;
  branchId: string | null;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  /** The refresh session this access token was minted alongside — lets `/auth/sessions` mark the caller's own device as `isCurrent`. */
  sid: string;
  /**
   * Standard JWT ID claim — a fresh random value per token, not derived from anything else.
   * Without it, two tokens signed within the same second for the same session (e.g. back-to-back
   * refreshes, which don't change `sid`) are byte-for-byte identical: `jsonwebtoken`'s `iat` has
   * only 1-second resolution, and every other claim is unchanged by rotation. Not a security
   * issue on its own, but it breaks the reasonable assumption that "refreshed" implies "a new
   * token" — this guarantees it.
   */
  jti: string;
}
