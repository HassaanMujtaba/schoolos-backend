# SchoolOS Backend

NestJS + PostgreSQL API for SchoolOS. See [`implementation-plan.md`](./implementation-plan.md) for
the full phase-by-phase build plan — this README is just how to run what's here today (Phase 0:
Foundation).

## Governing docs

- [`implementation-plan.md`](./implementation-plan.md) — phase-by-phase build plan, endpoint
  contracts (lifted from `../frontend/modules/*.md`), integration tracker
- [`SECURITY.md`](./SECURITY.md) — OWASP mapping and pentest-readiness checklist for this package
- [`../.claude/skills/security-standards/SKILL.md`](../.claude/skills/security-standards/SKILL.md)
  — the shared security baseline (frontend + backend)
- `../Complete_School_Management_System_PRD copy.md` — product requirements

## What's built (Phase 0 — Foundation)

- App bootstrap (`src/main.ts`): Helmet, CORS (explicit origin allowlist), global validation
  pipe (reject unknown/invalid input), global exception filter (consistent error shape), Swagger
  at `/docs` outside production, URI API versioning (`/v1/...`)
- Config (`src/common/config/`): typed, validated env (`class-validator`-checked at boot — fails
  fast on a missing/malformed variable rather than at first use)
- Request context (`src/common/context/`): `AsyncLocalStorage`-based tenant/user/permission
  context, populated by Phase 1's auth guard, read by everything downstream
- Multi-tenancy (`src/common/prisma/`): `PrismaService` scopes every query against a
  tenant-owned model to the request's resolved tenant automatically, fails closed if no tenant is
  in context — see `tenant-scoping.ts` and its own spec for the isolation proof
- RBAC (`src/common/guards/permissions.guard.ts` + `src/common/decorators/`):
  `@RequirePermission('students.read')` on any handler, checked against the request context's
  permission set
- Audit logging (`src/common/interceptors/audit.interceptor.ts`): every mutating request writes
  an append-only row automatically
- Health (`src/health/`): `GET /v1/health` checks Postgres + Redis connectivity
- Prisma schema (`prisma/schema.prisma`): `Tenant`, `Branch`, `User`, `Role`, `Permission`,
  `RolePermission`, `UserRole`, `AuditLog` — the Phase 0 entity set; every later phase adds its own
  models per `implementation-plan.md`
- Seed (`prisma/seed.ts`): the fixed Role/Permission catalog (PRD §4 roles,
  `implementation-plan.md`'s permission-string catalog)

**Not built yet:** everything past Phase 0 — there is no `AuthModule`, so nothing actually issues
a token yet and every tenant-scoped query will throw until `RequestContextService` has something
in it. That's Phase 1, next.

## Local development

Requires Docker (for Postgres/Redis/MinIO) and Node 22+.

```bash
cp .env.example .env.local        # defaults already match docker-compose.yml
docker compose up -d              # postgres, redis, minio
npm install
npm run prisma:migrate            # applies prisma/migrations, prompts for a name on first run
npm run prisma:seed               # seeds the Role/Permission catalog
npm run start:dev
```

- API: `http://localhost:3000/v1`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/v1/health`
- MinIO console: `http://localhost:9001` (schoolos / schoolos123)

## Scripts

| Script                                                                       | What it does                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run start:dev`                                                          | Nest in watch mode                                                                                          |
| `npm run build`                                                              | Production build to `dist/`                                                                                 |
| `npm run typecheck`                                                          | `tsc --noEmit`                                                                                              |
| `npm run lint` / `lint:fix`                                                  | ESLint (security + typescript-eslint rules — see `eslint.config.mjs`)                                       |
| `npm run format` / `format:check`                                            | Prettier                                                                                                    |
| `npm run secretlint`                                                         | Secret scanning                                                                                             |
| `npm run test` / `test:watch` / `test:cov`                                   | Vitest unit tests                                                                                           |
| `npm run test:e2e`                                                           | Vitest e2e tests (`test/`, against a real Postgres/Redis — see `implementation-plan.md`'s testing strategy) |
| `npm run verify`                                                             | typecheck + lint + format:check + secretlint + test — the CI gate, runnable locally                         |
| `npm run audit`                                                              | `npm audit --audit-level=high`                                                                              |
| `npm run prisma:migrate` / `prisma:deploy` / `prisma:seed` / `prisma:studio` | Prisma CLI wrappers                                                                                         |

## Contributing

Husky runs `lint-staged` on commit and `typecheck` + `secretlint` + `audit` on push — these are
developer convenience, not the real gate (they're bypassable with `--no-verify`); CI
(`.github/workflows/ci.yml`) runs `npm run verify` + `npm run build` on every push/PR and is the
actual gate, same split `../frontend/`'s CI already documents.

Add every new tenant-owned Prisma model to `src/common/prisma/tenant-scoped-models.ts` in the same
change that adds it to `schema.prisma` — see `SECURITY.md`'s "Multi-tenancy" section.
