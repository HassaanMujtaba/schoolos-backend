import { randomBytes } from 'node:crypto';

/**
 * Every enum this module introduced (`TenantStatus`, `SubscriptionStatus`, `BillingRecordStatus`,
 * `FeatureFlagScope`) was deliberately spelled so its uppercase Prisma member name lowercases into
 * exactly the literal union `frontend/src/features/platform/schemas.ts`/`api.ts` expects
 * (`ACTIVE` → `'active'`, `GRACE` → `'grace'`, ...) — one
 * generic cast here instead of a bespoke switch per enum. If a future enum member's name doesn't
 * lowercase-match its frontend counterpart, this is the one place that assumption would need to
 * become a real mapping table.
 */
export function lowerEnum<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

/** The upper-casing inverse, for DTOs that accept the frontend's lowercase literal as input. */
export function upperEnum<T extends string>(value: string): T {
  return value.toUpperCase() as T;
}

const SLUG_SUFFIX_LENGTH = 5;

/**
 * `Tenant.slug` has been a required unique column since Phase 0, but nothing has ever had to
 * generate one — every earlier phase's tenants were created directly via Prisma in a test/seed
 * script with a hand-picked slug. `POST /platform/schools` (this phase) is the first real caller,
 * so this is the first real slug generator. No subdomain routing reads `slug` yet anywhere in this
 * codebase; this only has to be a stable, URL-safe, unique identifier, not a polished one.
 */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'school';
}

export function slugSuffix(): string {
  return randomBytes(SLUG_SUFFIX_LENGTH)
    .toString('hex')
    .slice(0, SLUG_SUFFIX_LENGTH);
}
