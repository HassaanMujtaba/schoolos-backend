# SchoolOS Backend — Security

This package's specifics against the shared baseline in
[`../.claude/skills/security-standards/SKILL.md`](../.claude/skills/security-standards/SKILL.md)
(and `frontend/SECURITY.md`, its frontend counterpart). Read that skill first — this file only
records what's specific to the NestJS API, not the principles themselves.

## OWASP Top 10 — how this package addresses each

| #                             | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | This package's mitigation |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| A01 Broken Access Control     | `PermissionsGuard` (`src/common/guards/permissions.guard.ts`) enforces `@RequirePermission` server-side on every route; `PrismaService`'s tenant-scoping extension (`src/common/prisma/tenant-scoping.ts`) makes cross-tenant reads structurally impossible for any model in `TENANT_SCOPED_MODELS`, not just permission-gated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A02 Cryptographic Failures    | Access tokens short-lived (`JWT_ACCESS_TTL`, ~15 min) and returned in the response body only (frontend keeps them in memory); refresh tokens are opaque (never a JWT), httpOnly/Secure/SameSite=Strict cookies, stored in Redis as `sha256(secret)` only (`auth/session.service.ts`); password hashing via bcrypt, cost 12; no secret ever logged (`HttpExceptionFilter` logs stack traces, never request bodies)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A03 Injection                 | Prisma's parameterized query builder only — no raw SQL string concatenation anywhere in this codebase; `class-validator` DTOs with `whitelist: true, forbidNonWhitelisted: true` reject any unexpected field before a handler runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A04 Insecure Design           | `RequestContextService` resolves tenant/user/permissions server-side from a verified token, never from a client-supplied field — see its own doc comment for why that's a `patch`, not a trust boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A05 Security Misconfiguration | `helmet()` + explicit CORS origin allowlist (`AppConfigService.corsOrigins`, never `*`) wired in `main.ts`; Swagger docs (`/docs`) disabled outside non-production per `main.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A06 Vulnerable Components     | `npm audit --audit-level=high` in CI (`.github/workflows/ci.yml`) and in the pre-push hook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A07 Auth Failures             | `AuthModule` (Phase 1) owns JWT issuance/refresh/rotation — see `../implementation-plan.md`'s Phase 1 section for the exact contract. Refresh-token rotation on every use, with reuse detection: a replayed (already-rotated-away) refresh cookie revokes the _whole_ session, not just that one request (`session.service.ts`). A per-identifier failed-login counter (Redis, 10/15min) locks out further attempts before falling through to a password check. Login/refresh/forgot-password/reset-password are throttled tighter than the global default (`AuthController`'s `AUTH_THROTTLE`, 10/min vs. the app-wide 100/min). A password reset revokes every existing session for that account. Login never reveals whether an identifier matched an account (generic "Invalid credentials" either way, plus a dummy-hash bcrypt compare on no-match to reduce timing signal) |
| A08 Data Integrity Failures   | Dependencies pinned to exact-enough semver ranges in `package.json`, installed via `npm ci` in CI (lockfile-exact)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A09 Logging Failures          | `AuditInterceptor` (`src/common/interceptors/audit.interceptor.ts`) writes an append-only row for every mutating request; `HttpExceptionFilter` correlates error responses to logs via `x-request-id` without ever logging a request body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A10 SSRF                      | No outbound fetch-from-user-input exists yet in this codebase; the AI layer (Phase 7.10) and any future webhook/integration work must allowlist destinations before this becomes a real surface — flag it when that phase starts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Multi-tenancy — the specific mechanism

`PrismaService` wraps `applyTenantScoping` (`src/common/prisma/tenant-scoping.ts`) into every
Prisma query via `$extends()`. Two properties worth knowing before adding a new model:

1. **A model is only scoped if it's listed in `TENANT_SCOPED_MODELS`**
   (`src/common/prisma/tenant-scoped-models.ts`) — this is deliberately an explicit allowlist, not
   an auto-detected one, so a new tenant-owned model is _unscoped by default_ until someone adds
   it there. Add every new tenant-owned Prisma model to that list in the same change that adds it
   to `schema.prisma`.
2. **A tenant-scoped query with no tenant in request context throws, it does not run unscoped —
   including inside `RequestContextService.runAsPlatform()`.** That's deliberate, not a gap:
   `tenant-scoping.spec.ts`'s own "runAsPlatform bypasses per-tenant scoping deliberately" test
   documents that `runAsPlatform()` does _not_ make `PrismaService` queries unscoped; a genuinely
   cross-tenant read has to go through a separate, explicitly un-extended client instead —
   `PlatformPrismaService` (`src/common/prisma/platform-prisma.service.ts`), a second Prisma
   client with no `applyTenantScoping` hook at all. Two sanctioned call sites today:
   `users/users.service.ts`'s auth-profile lookups (resolving a login identifier, or re-syncing
   roles/permissions on refresh — both necessarily run before any tenant context exists), and the
   Phase 7.9 Platform Console once it's built. Treat a new call site for `PlatformPrismaService`
   the same way as a new `runAsPlatform()` call site: real, unfiltered cross-tenant access, worth
   a second look in review.

See `src/common/prisma/tenant-scoping.spec.ts` for the isolation proof referenced in
`../implementation-plan.md`'s Phase 0 exit criterion.

## Pentest-readiness checklist (backend-specific)

- [ ] Every tenant-scoped model is in `TENANT_SCOPED_MODELS`
- [ ] Every mutating endpoint has an explicit `@RequirePermission(...)` (or is deliberately
      `@Public()` with a documented reason)
- [ ] No endpoint trusts a client-supplied `tenantId`, `userId`, or role/permission claim in a
      request body/query/param
- [ ] File upload endpoints (Phase 3+) validate type/size server-side and never serve from a
      public bucket — signed, time-limited URLs only
- [ ] `npm audit --audit-level=high` clean (or documented exceptions) before each release — current
      accepted exception: `prisma`/`@prisma/config`'s transitive `deepmerge-ts` stack-exhaustion
      advisory ([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)), a
      dev-CLI-only DoS vector (`prisma generate`/`migrate`/`studio`) with no fixed stable release
      yet upstream; not present in the runtime `@prisma/client`. Re-check on every `prisma`
      version bump and drop this line once a fixed stable release exists.
- [ ] Rate limiting covers auth, search, export, and any bulk-operation endpoint
- [ ] Secrets (`JWT_*_SECRET`, `DATABASE_URL`, S3 credentials) come from the deploy environment's
      secret manager in every non-local environment — `.env.example` documents the shape, never
      real values
- [ ] Every `PlatformPrismaService` call site is one of the sanctioned ones documented above — a
      new one is real cross-tenant access and needs review, not a routine addition
- [ ] Known open item: `POST /auth/login`'s `identifier` carries no tenant/school selector, but
      `User.email`/`phone` are only unique _within_ a tenant — a same-identifier collision across
      two tenants currently fails closed (treated as "no such user") rather than picking one; this
      needs a product decision once multi-tenant identifier collisions are a real scenario, not
      just a same-account-different-school edge case (`auth.service.ts`'s own doc comment,
      `../implementation-plan.md` Phase 1 notes)

## Before calling security-sensitive backend work "done"

Follow `security-standards`' own "Before calling security-sensitive work done" checklist. In this
package specifically, that means: `npm run verify` green, the OWASP table above re-checked against
the specific feature just built (not the whole app), and — if the change touches auth, tenant
scoping, RBAC, payments, or file handling — call it out explicitly rather than treating it as a
routine change.
