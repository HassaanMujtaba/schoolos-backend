/**
 * Explicit allowlist of Prisma models that carry `tenantId` and must be scoped on every query.
 *
 * Deliberately a hardcoded list, not derived by inspecting the Prisma DMMF for a `tenantId`
 * field at runtime — an explicit list is something a reviewer can read and a new model is
 * "invisible" (unscoped) by default until someone adds it here, which is the fail-closed
 * direction. The alternative (auto-detect by field name) fails open: a typo'd field name would
 * silently scope nothing.
 *
 * Add every new tenant-owned model here in the same PR that adds it to `schema.prisma`, or its
 * queries will run genuinely unscoped — `PrismaService`'s query extension only touches models in
 * this set.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'Branch',
  'User',
  'UserRole',
  'AuditLog',
]);
