# SchoolOS — Backend Implementation Plan

Scope: the **NestJS + TypeScript API** (REST + a WebSocket gateway) that
[`frontend/implementation-plan.md`](../frontend/implementation-plan.md) already assumes a contract
against. Built module-by-module, phase-by-phase, **paired with the frontend's own phases** so each
phase ends with a real integration pass, not just two halves that happen to compile separately.

Governing docs — read these before starting any phase:

- PRD (`../Complete_School_Management_System_PRD copy.md`) — §45 (entities), §46 (backend module
  list, background workers), §48 (infrastructure), §51 (API design), §52 (API security), §53 (SaaS
  billing), §54 (Super Admin) are this plan's direct source material.
- `frontend/SECURITY.md` + the `security-standards` skill — this is the **one** security baseline
  for the whole product, frontend and backend; the auth pattern documented there (short-lived
  in-memory access token, httpOnly rotating refresh cookie, `SECURITY.md` A01–A10 mapping) is not
  a frontend-only convention, it's what this backend must actually implement.
- `frontend/implementation-plan.md` + `frontend/modules/*.md` — **the source of truth for the API
  contract.** Read this the other way round from a normal backend build: the frontend already
  shipped every MVP module and nearly every backlog module against an _assumed_ REST shape (each
  module doc's own "Backend dependencies" section). This plan's job is to implement those shapes
  where they're reasonable and flag a small, explicit list of changes back to frontend where
  they're not — never to silently invent a different API and leave the frontend's assumptions
  stranded.

## Why this plan reads differently from a normal greenfield backend plan

Most backend implementation plans design the API first and let the frontend follow. Here the
frontend got built first, against assumed contracts, specifically so that every screen, form, and
workflow in the product could be designed and reviewed without waiting on backend. That means:

- **The contract is mostly already decided.** Every phase below lists exact endpoints, request
  shapes, and status-machine states lifted directly from the corresponding `frontend/modules/*.md`
  "Backend dependencies" section — not re-derived from the PRD from scratch.
- **"Done" for a backend phase is an integration pass, not a green test suite in isolation.** Each
  phase's exit criterion is: run the already-built frontend against the real backend locally, fix
  whatever drifts (either side), and turn that module doc's "pending backend contract" line into
  "confirmed."
- **Where the frontend's assumption is a bad idea** (rare, but see the Phase 3 admissions/fees
  ordering problem and the Phase 3 document-upload timing problem below), this plan says so
  explicitly and proposes the fix, rather than building an endpoint nobody should actually call
  that way.

## Tech stack decisions

Per PRD §46/§48's recommendation, filled in with concrete choices:

| Concern        | Choice                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework      | NestJS 10, TypeScript strict                                                                                                                                                                                                                                                           | PRD §46                                                                                                                                                                                                                                                                                                                                                           |
| Architecture   | Modular monolith (one deployable, Nest module boundaries matching the folder list below)                                                                                                                                                                                               | 30+ feature areas is a lot of services to operate day one; split out only what actually needs independent scaling later (candidates: `ai`, `notifications` workers)                                                                                                                                                                                               |
| Database       | PostgreSQL 16                                                                                                                                                                                                                                                                          | PRD §45                                                                                                                                                                                                                                                                                                                                                           |
| ORM            | Prisma                                                                                                                                                                                                                                                                                 | Schema-first migrations, strong generated TS types, and — closing the frontend plan's own "no generated API client yet" risk note — a straightforward path to generating an OpenAPI spec (`@nestjs/swagger`) the frontend can eventually codegen a typed client from, replacing 30+ hand-written `features/*/api.ts` files without changing their call signatures |
| Cache / queues | Redis + BullMQ                                                                                                                                                                                                                                                                         | PRD §46 background workers (email, SMS, WhatsApp, PDF, report generation, AI, OCR, notifications, imports/exports, scheduled jobs); also the refresh-token/session store and the Socket.IO adapter for horizontal scaling                                                                                                                                         |
| Object storage | S3-compatible (S3 in prod, MinIO in dev)                                                                                                                                                                                                                                               | PRD §31 documents, §35 AI document processing, all `FileUploadField` consumers already staged on the frontend                                                                                                                                                                                                                                                     |
| Realtime       | Socket.IO gateway at `/ws`, Redis adapter                                                                                                                                                                                                                                              | Matches PRD §51's exact event list; frontend already deferred every realtime feature to "after REST flows are proven," so the gateway can land after each module's REST half without blocking anything                                                                                                                                                            |
| Validation     | `class-validator`/`class-transformer` DTOs, field names matching each frontend `schemas.ts` (Zod) 1:1                                                                                                                                                                                  | Keeps the two sides' validation rules from silently diverging                                                                                                                                                                                                                                                                                                     |
| API docs       | `@nestjs/swagger`, served at `/docs`                                                                                                                                                                                                                                                   | Also the source for the future generated client above                                                                                                                                                                                                                                                                                                             |
| Auth tokens    | JWT access token (short-lived, ~15 min, returned in the login/refresh response body — frontend keeps it in memory only, never localStorage), rotating refresh token in an httpOnly/Secure/SameSite=Strict cookie, session store in Redis (device/session list, revocation, logout-all) | Must match `frontend/src/lib/http/apiClient.ts`'s already-built single-flighted refresh flow and `SECURITY.md`'s documented pattern exactly — this is not a free choice, it's matching code that already exists                                                                                                                                                   |
| Search         | PostgreSQL full-text (`tsvector`) to start                                                                                                                                                                                                                                             | PRD §42 — matches `fees.md`'s already-built `/search` assumption; Meilisearch/OpenSearch stays a later swap if search quality becomes a real complaint                                                                                                                                                                                                            |

## Multi-tenancy & RBAC — build once, correctly, before any feature module

This is Phase 0's actual point, not a formality:

- **Tenant isolation.** Every tenant-owned Prisma model carries `tenantId` (+ `branchId` where
  applicable). A request-scoped `TenantContextService` resolves `tenantId` from the authenticated
  session — **never** from a client-supplied header, query param, or body field (PRD §52's
  explicit "never trust tenantId from the client") — and a Prisma [client
  extension](https://www.prisma.io/docs/orm/prisma-client/client-extensions)/middleware injects
  `WHERE tenantId = :ctx` on every tenant-scoped query so a missing filter fails closed, not open.
  Unit-test this with two fake tenants and assert cross-tenant reads return nothing, before writing
  a single feature endpoint on top of it.
- **RBAC.** One permission catalog, seeded into the DB (`Role`, `Permission`, `RolePermission`
  tables), using the _exact_ permission strings every `frontend/modules/*.md` doc already committed
  to (collected below) — a `PermissionsGuard` + `@RequirePermission('students.read')` decorator
  reads from the authenticated user's resolved permission set, mirroring
  `frontend/src/lib/permissions.ts`'s `can`/`canAll`/`canAny` shape so the two sides reason about
  permissions identically.
- **Audit logging.** An interceptor wrapping every mutating endpoint, writing an append-only
  `AuditLog` row (who/what/when/where/entity/old value/new value/IP/device, per PRD §43) —
  append-only enforced at the DB grant level (application role has `INSERT` but not `UPDATE`/
  `DELETE` on `audit_log`), not just by convention.

### Permission catalog (collected from every frontend module doc)

Seed these verbatim — they're not a proposal, they're what the already-built frontend already
calls `can('students.read')` (etc.) with:

```text
students.read / students.create / students.update / students.delete / students.export
parents.read / parents.create / parents.update / parents.delete
teachers.read / teachers.create / teachers.update / teachers.delete / teachers.assign
admissions.read / admissions.create / admissions.update / admissions.review /
admissions.approve / admissions.reject
school.read / school.update
branches.read / branches.create / branches.update / branches.delete
academic-years.read / academic-years.create / academic-years.update / academic-years.delete
classes.read / classes.create / classes.update / classes.delete
sections.read / sections.create / sections.update / sections.delete
subjects.read / subjects.create / subjects.update / subjects.delete
timetable.read / timetable.update
attendance.read / attendance.mark / attendance.modify / attendance.export
homework.read / homework.create / homework.update / homework.delete / homework.grade
exams.read / exams.manage / marks.enter / results.publish
fees.read / fees.create / fees.collect / fees.refund / fees.delete
library.read / library.manage-catalog / library.circulate
transport.read / transport.manage / transport.track
inventory.read / inventory.manage / assets.read / assets.manage
hostel.read / hostel.manage / hostel.allocate
hr.read / hr.manage / payroll.read / payroll.run / payroll.approve
leave.request / leave.approve
messages.send / announcements.read / announcements.create / events.manage
ptm.manage / ptm.book
documents.read / documents.upload / documents.delete
certificates.generate / certificates.read
reports.read / reports.export
platform.schools.manage / platform.subscriptions.manage / platform.billing.read /
platform.feature-flags.manage / platform.support.read / platform.audit.read /
platform.roles.manage
ai.query / ai.generate-content / ai.view-analytics
```

Confirm this list with frontend before final seed — it's assembled from ~20 module docs and is the
single most load-bearing contract in the whole integration (every `RequirePermission` call on the
frontend depends on the string matching exactly).

**Phase 2 correction:** the school-setup row above was originally drafted as a single
`school-setup.manage` bucket; the actually-built frontend (`router.tsx`, `navConfig.ts`, every
`features/school-setup` form/table) calls `usePermission`/`RequirePermission` with the granular
per-entity strings shown above instead. Checked against the real frontend source, not just the
module doc, since the doc's own "Roles & permissions" section already had the granular list and the
catalog above just hadn't been reconciled with it yet — `prisma/seed.ts` now seeds the granular
strings.

**Phase 3 correction (same pattern):** the parents/teachers/admissions rows above were originally
drafted as `parents.manage`/`teachers.manage`/`admissions.manage` buckets; the actually-built
frontend (`ChildLinkPanel.tsx`'s `usePermission('parents.update')`, every `StagePanels.tsx` panel's
per-action `usePermission` call, `AssignmentPanel`'s `teachers.assign`) calls granular per-action
strings — `admissions.review`/`admissions.approve`/`admissions.reject` in particular are each their
own permission, distinct from `admissions.update`, because the frontend's `ReviewPanel`/
`DecisionPanel` gate the "approve for entrance test" / "accept" / "waitlist" / "reject" actions
separately from the general edit actions every other stage panel gates on `admissions.update`.
`prisma/seed.ts` now seeds the granular strings.

**Phase 4 correction (same pattern):** the timetable/homework rows above were originally drafted
as `timetable.manage`/`timetable.generate` and `homework.manage` buckets; the actually-built
frontend (`TimetableGridPage.tsx`/`SubstitutionsTable.tsx`'s single `usePermission('timetable.
update')` gate covering every editing/generation/substitution action; `HomeworkList.tsx`/
`HomeworkListPage.tsx`'s granular `usePermission('homework.create'/'homework.update'/
'homework.delete')`) calls different strings. `homework.grade` is kept from the original catalog
even though nothing client-side gates the grading form on it yet — server-side enforcement
(`PATCH /homework/submissions/:id`) doesn't depend on the frontend checking it first.
`prisma/seed.ts` now seeds the corrected strings.

## Folder structure

Mirrors the frontend's feature-based convention (`frontend/implementation-plan.md` "Architecture
conventions") so the two repos read the same way side by side:

```
backend/
├── src/
│   ├── main.ts                 # Helmet, CORS (locked to frontend origin), global ValidationPipe,
│   │                           # global exception filter, Swagger bootstrap
│   ├── app.module.ts
│   ├── common/
│   │   ├── guards/              # PermissionsGuard, TenantGuard
│   │   ├── decorators/          # @RequirePermission, @CurrentUser, @CurrentTenant
│   │   ├── interceptors/        # AuditInterceptor, TransformResponseInterceptor
│   │   ├── filters/              # global HttpExceptionFilter → consistent error shape
│   │   └── prisma/               # PrismaService (tenant-scoping extension)
│   ├── auth/                    # see Phase 1
│   ├── users/
│   ├── tenants/                 # + branches/
│   ├── school-setup/            # academic years, classes, sections, subjects
│   ├── students/
│   ├── parents/
│   ├── teachers/
│   ├── admissions/
│   ├── documents/               # shared upload/retrieval primitive — needed starting Phase 3
│   ├── timetable/
│   ├── attendance/
│   ├── homework/
│   ├── examinations/
│   ├── fees/
│   ├── accounting/
│   ├── payroll/
│   ├── hr/
│   ├── library/
│   ├── transport/
│   ├── inventory/
│   ├── hostel/
│   ├── communication/           # notifications, messages, announcements, events, ptm
│   ├── certificates/
│   ├── reports/
│   ├── search/
│   ├── platform/                # Super Admin console: schools, plans, billing, feature flags
│   ├── ai/                      # last, see Phase 7+
│   ├── audit/
│   ├── health/
│   └── ws/                      # Socket.IO gateway
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test/                        # e2e (supertest) — one spec per module, run against a real
│                                # Postgres/Redis via docker-compose, not mocks
└── docker-compose.yml            # postgres, redis, minio — local dev parity with prod shape
```

## Phase-by-phase build plan

Phases are numbered to match `frontend/implementation-plan.md` exactly, so "Phase 4" always means
the same slice of the product on both sides. Each phase lists the NestJS modules, the Prisma
entities, the endpoints (taken from the frontend module doc named), and the concrete integration
step that closes out that module doc's "pending backend contract" line.

### Phase 0 — Foundation ✅ scaffolded

**Status:** the repo itself now exists (`backend/`, its own git repo, sibling to `frontend/`) with
everything below built and passing `npm run verify` + `npm run build` — see git history for detail.
**Not yet done:** an actual Prisma migration file (`prisma migrate dev` needs a live Postgres,
which this environment doesn't have — run `docker compose up -d && npm run prisma:migrate` once);
the two-tenant isolation proof exists today as a fast, DB-free unit test
(`src/common/prisma/tenant-scoping.spec.ts`, testing the extracted `applyTenantScoping` logic
directly) rather than an integration test against a real database — `test/health.e2e-spec.ts` is
written and ready but, same reason, unverified against a live stack in this environment. Both are
the first things to run once Postgres/Redis are reachable, before starting Phase 1.

**Modules:** `common/` (guards, interceptors, filters, Prisma tenant-scoping), `health/`.

**Entities:** `Tenant`, `Branch`, `User`, `Role`, `Permission`, `RolePermission`, `AuditLog`.

**Deliverables:**

- Nest CLI scaffold; ESLint/Prettier config aligned with frontend's (same rule intent, not
  necessarily the same config file); Husky pre-commit/pre-push; GitHub Actions CI
  (`lint` + `test` + `build`, matching `frontend/.github/workflows/ci.yml`'s shape).
- `docker-compose.yml`: postgres, redis, minio — `npm run dev` should bring up a fully working
  local stack with one command, same "clone and go" bar the frontend already meets.
- Prisma schema skeleton (the six entities above) + first migration.
- `PrismaService` with the tenant-scoping extension, `PermissionsGuard` + `@RequirePermission`,
  `AuditInterceptor`, global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`,
  global exception filter producing an error shape the frontend's `ErrorState` component can render
  directly (`{ statusCode, message, error, requestId }`).
- Rate limiting (`@nestjs/throttler`), Helmet, CORS locked to the frontend's known origins.
- `GET /health` — liveness/readiness (DB, Redis, storage reachability) for PRD §61 observability
  and for infra health checks.
- Swagger at `/docs`.

**Definition of done:** CI green; a two-tenant Prisma test proves cross-tenant row isolation; a
permission-denied request returns 403 with the same error shape as any other failure.

**Unblocks:** everything else. No frontend-facing endpoints ship this phase.

---

### Phase 1 — Auth & Identity ✅ built, backend side confirmed

Pairs with **frontend Phase 1 (done)** — [`frontend/modules/auth.md`](../frontend/modules/auth.md).
This is the very first real integration milestone: the frontend's entire session/permission model
already exists and is tested against a _guessed_ shape of this response.

**Status:** `auth/` + `users/` built (`src/auth/`, `src/users/`), unit-tested
(`session.service.spec.ts`'s rotation/reuse-detection proof, `duration.spec.ts`) and e2e-tested
against a live Postgres/Redis (`test/auth.e2e-spec.ts`: login → `/me` → refresh-rotation-with-
reuse-detection → `/sessions` → logout/logout-all → forgot/reset-password, all against the real
HTTP surface). `npm run verify` and `npm run test:e2e` both green; a real `nest build` + `node
dist/main` boot was also curl-verified (helmet headers, CORS, the tighter auth-endpoint throttle,
and the `HttpExceptionFilter` error shape all present on a live response). Two real bugs found and
fixed along the way, not just this phase's own code:

- `env.validation.ts`'s `PORT` never actually validated correctly — `enableImplicitConversion`
  depends on reflected `design:type` metadata that esbuild/SWC-based transpilers (Vite/vitest,
  ts-node in transpile-only mode) don't compute for an inferred-type property, so `PORT` silently
  stayed a string and failed `@IsInt()`. Fixed with an explicit `@Type(() => Number)`. This is also
  why `test/health.e2e-spec.ts` had never actually been run before this phase, despite Phase 0's
  status note describing it as "written and ready."
- The frontend's `VITE_API_BASE_URL` assumed `/api`; this backend serves under `/v1` (URI
  versioning, `main.ts`). Fixed `frontend/.env.example` — flagging it here since it's exactly the
  kind of frontend-assumption correction this plan's intro describes.

**A design decision this phase had to make that the frontend's assumed contract doesn't address:**
`LoginDto.identifier` (email or phone) carries no tenant/school selector, but `User.email`/`phone`
are only unique _within_ a tenant (`schema.prisma`'s `@@unique([tenantId, email])`). Resolved by
treating a same-identifier collision across tenants as "no such user" (fail closed, never guess) —
see `auth.service.ts`'s own doc comment and `SECURITY.md`'s pentest checklist. This needs an actual
product conversation once multi-school identifier collisions are a real scenario, not a hypothetical.

**Also found, not part of this phase's own scope but discovered doing a real browser click-through
against the built frontend:** `RequireAuth`/`useSession`'s bootstrap doesn't settle cleanly when
every `/auth/refresh` attempt fails (observed here via this backend's own rate limiter returning 429) — the UI flickered between `/login` and `/dashboard` instead of the hard redirect-to-`/login`
`modules/auth.md` itself specifies ("never loop silently"). This is frontend code, out of scope for
this backend-focused pass, but worth a frontend-side follow-up; `RequireAuth.test.tsx`'s mocked
network layer wouldn't catch this since it's a timing/retry-storm issue only a real backend
surfaces.

**Module:** `auth/`, `users/`.

**Entities:** `User`, `Session`/`RefreshToken` (Redis, not Postgres — short-lived, high-churn).

**Endpoints** (from `modules/auth.md` "Backend dependencies," unchanged):

```
POST /auth/login          email/phone + password → { accessToken, user, roles, permissions }
                           refresh token set as httpOnly cookie, not in the body
POST /auth/refresh        rotates the access token off the httpOnly refresh cookie
GET  /auth/me             rehydrate { user, roles, permissions } on app load
POST /auth/logout         revoke current session
POST /auth/logout-all     revoke every session for this user
POST /auth/forgot-password
POST /auth/reset-password
GET  /auth/sessions       active sessions/devices + last-active, for SessionsDialog
```

**Integration task (the actual point of this phase):** confirm the exact `{ user, roles,
permissions }` shape and the real role-name strings with frontend _before_ anything else consumes
them — `frontend/src/features/auth/portal.ts`'s `resolvePortalPath` keys off these role strings
directly, and every `RequirePermission` call in the app depends on the permission-string catalog
above matching. Run `frontend`'s existing `RequireAuth.test.tsx`/`hooks.test.tsx`/`portal.test.ts`
against this real backend locally (not just its own mocks) as the phase's exit test.

**Explicitly out of scope for MVP** (per `modules/auth.md`'s own note): OTP, Google/Microsoft
login, MFA — PRD §5 lists them, but they're not in the PRD §65 MVP list on the frontend side
either; build the plain email/phone+password flow first.

---

### Phase 2 — School Setup & Core Entities ✅ built, backend side confirmed

Pairs with **frontend Phase 2 (done)** —
[`frontend/modules/school-setup.md`](../frontend/modules/school-setup.md).

**Status:** `tenants/` + `school-setup/` built (`src/tenants/branches/`,
`src/school-setup/{schools,academic-years,classes,sections,subjects}/`), migration
`20260906191241_phase2_school_setup` committed, unit-tested
(`tenant-scoping.spec.ts`'s new flat-merge/nested-write coverage) and e2e-tested
(`test/school-setup.e2e-spec.ts`: school-profile lazy-create + PATCH validation, branch
create/list/search/get/update-replaces-children/delete, academic-year create with nested
terms/holidays + computed `isCurrent` + inverted-date-range rejection, class→section→subject
referential checks including cross-tenant-id rejection and cascade-delete, all with a
read-only-role-gets-403 and wrong-tenant-gets-404 case per resource). `npm run verify` green
(typecheck/lint/format/secretlint/unit); e2e unverified against a live stack in this
environment (same Postgres/Redis-not-reachable-here reason as every other phase — run
`test:e2e` once Docker is available, before starting Phase 3).

**Nested-resource shape resolved:** buildings/departments and terms/holidays are **not**
separate sub-resource endpoints — they're plain arrays nested in the parent's own
create/update payload (`BranchDto.buildings`/`.departments`,
`AcademicYearDto.terms`/`.holidays`), replaced wholesale (delete-then-recreate in one
transaction) on every parent write. This matches the frontend's actual built shape
(`BranchFormValues`/`AcademicYearFormValues`'s `useFieldArray`-submitted full lists), not a
guess — `modules/school-setup.md`'s "flat vs. nested" open question is closed in favor of
nested-array-in-payload. They're still real child tables underneath (`Building`, `Department`,
`Term`, `Holiday` — see `schema.prisma`'s own doc comments), not JSON columns, so they stay
queryable/indexed like everything else.

**A real bug found and fixed along the way, not just this phase's own code:** the tenant-scoping
Prisma extension (`tenant-scoping.ts`) AND-wrapped every operation's `where`, including
`findUnique`/`update`/`upsert`/`delete` — but those take a `WhereUniqueInput`, which Prisma
requires a top-level unique selector for, and AND-wrapping strips that level away
(`PrismaClientValidationError`). Phase 0/1 never exercised this path (no `findUnique`/`update`/
`delete` on a tenant-scoped model yet); Phase 2's branch/class/section/subject CRUD is the first
to call it. Fixed by flat-merging `tenantId` into the where for those five operations instead of
AND-wrapping, same never-trust-a-client-supplied-`tenantId` guarantee, different merge shape —
see `tenant-scoping.ts`'s own doc comment and the new tests in `tenant-scoping.spec.ts`.

**A related limit documented, not a bug:** the same extension only sees a call's top-level
`model`/`operation` — it has no visibility into a nested `data.buildings: { create: [...] }`
write, so `Building`/`Department`/`Term`/`Holiday` rows created through a parent's nested payload
get no `tenantId` from the extension at all (their `tenantId` column is required, so this fails
loudly rather than silently, but every service with a tenant-scoped nested write has to stamp
`tenantId` in by hand — see `BranchesService.create`'s own doc comment, and
`tenant-scoping.spec.ts`'s "does NOT reach into a nested relation create" test documenting the
limit directly).

**Permission catalog correction:** see the "Phase 2 correction" note earlier in this doc — the
granular per-entity strings (`branches.read`, `academic-years.create`, etc.) replace the original
`school-setup.manage` placeholder, seeded and wired into every controller's `@RequirePermission`.

**Module:** `tenants/` (branches), `school-setup/` (academic years, classes, sections, subjects).

**Entities:** `Branch`, `Campus`, `Building`, `Department`, `AcademicYear`, `Term`, `Class`,
`Section`, `Subject`, `Holiday`.

**Endpoints:**

```
GET/PATCH  /schools/current           school profile
CRUD       /branches                  (+ nested buildings/departments)
CRUD       /academic-years            (+ nested terms/holidays)
CRUD       /classes
CRUD       /sections
CRUD       /subjects
```

**Integration task:** run `frontend`'s existing school-setup component/hook tests against this real
backend locally (not just its own mocks) once Postgres/Redis are reachable — the nested-resource
shape question itself is resolved above, so this phase's remaining integration step is verification,
not a design decision.

---

### Phase 3 — People ✅ built, backend side confirmed

Pairs with **frontend Phase 3 (done)** — `modules/students.md`, `modules/parents.md`,
`modules/teachers.md`, `modules/admissions.md`.

**Status:** `students/`, `parents/`, `teachers/`, `admissions/`, `documents/` (the shared upload
primitive), and `common/storage/` (a real S3/MinIO client — `@aws-sdk/client-s3` +
`s3-request-presigner`, presigned-URL reads, dev-only auto-bucket-creation, a new `storage`
`GET /health` check closing Phase 0's own noted gap) all built, migration
`20260907162109_phase3_people_documents` applied. Unit-tested and, for the first time in this
environment, **e2e-tested against a genuinely live stack** — Docker was reachable this phase (with
the user's explicit consent for one `prisma migrate reset` needed after a local migration-file
mixup; see git history) — `test/people-documents.e2e-spec.ts` (32 tests: the full admissions
pipeline stage-by-stage including permission-per-stage gating, student/parent/teacher CRUD,
tenant/permission isolation, and a real upload → presigned-URL → actual byte-for-byte download
round trip against MinIO). Running e2e also retroactively confirmed Phase 0–2's own e2e specs for
the first time — `npm run verify` and the full e2e suite (48 tests, all 4 spec files) are both
green against real Postgres/Redis/MinIO, not just typechecked.

**Two schema corrections against the real frontend source, same discipline as Phase 2's own
correction notes** — the original entity list below was drafted from the module docs' prose before
checking `frontend/src/features/*/api.ts` directly:

- **No separate `Guardian` entity.** `parents/api.ts`'s `linkChild` takes one `relation` string
  (`father`/`mother`/`guardian`/`other`); "parent" vs. "guardian" is the same `ParentStudentLink`
  join table split by `relation` at read time, not two entities.
- **No separate `AdmissionInquiry` entity.** `admissions/api.ts`'s `Admission` is one record
  carrying a `stage` field through the whole pipeline, not an inquiry promoted into a distinct
  application record — modeled as one `AdmissionApplication` table.

**The admissions stage-transition contract is also simpler than this plan originally sketched**:
checking `admissions/api.ts` directly (not just the module doc's prose) shows there's no
`submit`/`review`/`schedule-test`/`interview`/`accept`/`reject`/`mark-fee-payment` per-action
endpoint set — **one** `PATCH /admissions/:id` handles every stage transition and applicant/
application-detail edit (`{ stage?, applicant?, applicationDetails? }`), plus four dedicated
actions (`documents`, `score`, `decision`, `enroll`). Server-side, that one generic endpoint is
where the real state-machine enforcement lives — see `AdmissionsService`'s `STAGE_ORDER`/
`STAGE_ENTRY_PERMISSION`: a transition may only move exactly one step forward (no skipping, no
backward — rejection is the separate `decision` field, not a stage), `review → entrance_test` and
`acceptance → fee_payment` each need a permission beyond the route's baseline `admissions.update`
(matching `StagePanels.tsx`'s per-panel `usePermission` calls — see the Phase 3 permission
correction below), and `fee_payment` additionally requires `decision === 'accepted'` already set.
This closes the ordering decision below with the _real_ endpoint shape, not the guessed one.

**Modules:** `students/`, `parents/`, `teachers/`, `admissions/`, and — **build early, even though
its own dedicated frontend screens are Phase 7+** — `documents/`'s upload primitive.

**Entities:** `Student`, `Parent`, `Teacher`, `Enrollment`, `AdmissionApplication` (carries
`admissionFeeInvoiceId String?` — a plain id column, not a Prisma relation, since `Invoice` doesn't
exist until Phase 6; see the resolved ordering decision below), `Document`, `DocumentVersion`.

**Endpoints:**

```
CRUD  /students                    + GET /students/export (CSV)
CRUD  /parents                     + POST/DELETE /parents/:id/children (link/unlink),
                                    GET /parents/me/children (404s today — see status note below)
CRUD  /teachers                    + CRUD /teachers/:id/assignments
POST  /admissions                  create inquiry
GET   /admissions, /admissions/:id, /admissions/funnel
PATCH /admissions/:id              generic stage-transition + applicant/applicationDetails edit —
                                   the real state machine, see above
PATCH /admissions/:id/documents    placeholder, name-only (matches the frontend's own current
                                   not-a-real-upload state — see problem #2 below)
POST  /admissions/:id/score
PATCH /admissions/:id/decision     accept/waitlist/reject — gated by admissions.approve OR
                                   admissions.reject (a new @RequireAnyPermission/
                                   AnyPermissionsGuard pair, this phase's one cross-cutting addition
                                   — see `common/decorators/require-any-permission.decorator.ts`)
POST  /admissions/:id/enroll       creates the Student, see status note below
POST  /documents/upload            multipart, MIME/size allowlist + a documented malware-scan stub
                                   (checks for the EICAR test signature — not real AV, flagged
                                   loudly in code as a pre-production gap, not hidden)
GET   /documents, /documents/:id, /documents/:id/versions
PATCH /documents/:id               the two-step upload-before-owner-exists attach (problem #2)
DELETE /documents/:id
```

**Two real, deliberately-flagged design gaps found while building `enroll()` and the `Parent`
portal link** (not silently guessed at):

- **`POST /admissions/:id/enroll` has no data for a `gender`, a specific `sectionId`, or an
  admission number** — nothing in `InquiryFormValues`/`ApplicationDetailsFormValues` collects them,
  and the frontend's `enrollStudent` call takes no body either. Rather than blocking enrollment on
  an unrequested contract change, `enroll()` creates a real `Student` row with clearly-flagged
  interim defaults (gender `'other'`, the target class's first section, an auto-generated
  admission number) — staff are expected to correct these via the already-built Student edit form
  immediately after. See `AdmissionsService.enroll`'s own doc comment.
- **`Parent.userId`** (new, nullable, unique) links a portal login to a `Parent` profile so
  `GET /parents/me/children` can resolve "who am I the parent of" — but **nothing provisions it
  yet**. Creating a `Parent` here and creating a portal login (`auth.md`'s flow) are still two
  unconnected things; every `/parents/me/children` call 404s until a real "invite parent to the
  portal" flow exists. The field is there so that flow is additive, not a schema change, once
  scoped.

**Permission catalog correction (same pattern as Phase 2's):** see the "Phase 3 correction" note
earlier in this doc — `parents.manage`/`teachers.manage`/`admissions.manage` replaced with the
granular per-action strings the built frontend actually calls, including `admissions.review`/
`admissions.approve`/`admissions.reject` as their own permissions distinct from `admissions.update`.

**Not changed, despite Phase 2's own aspirational doc comment:** `Section.classTeacherName` stays
free text. That comment said "swap for real foreign keys once Phase 3 (Teachers) land," but
`SectionForm.tsx` genuinely built a free-text input, not a teacher picker — changing the contract
now would break the already-integration-tested Phase 2 surface for a field nothing in the built UI
even renders (`Student.classTeacherId` is always `null`, unused by `AcademicTab.tsx` today).

**Two known contract problems flagged in this plan's original Phase 3 section:**

1. **RESOLVED — admissions↔fees ordering.** Admissions' Fee Payment stage runs _before_ Enrollment
   creates the `Student` record, but `fees.md`'s `Invoice.studentId` is required — `modules/
admissions.md` and `modules/fees.md` both flagged this as unresolved. **Decision: option (a),
   not (b).** Keep the PRD §7 stage order and the already-built frontend stepper exactly as they
   are (Fee Payment → Enrollment) — reordering it (option b) would mean creating a `Student` record
   for every applicant who reaches Acceptance whether or not they ever pay the admission fee, which
   is worse data hygiene than a nullable FK, contradicts the PRD's explicit pipeline, and would
   force real frontend rework (stepper order, its tests) for a problem that's actually
   backend-model-shaped. It also matches how this actually works at a real school: the admission
   fee is what confirms the seat, paid _before_ the school commits to enrolling the student — the
   data model should represent that order, not the reverse.

   Concretely:
   - **Phase 6** (when `Invoice` is built): `Invoice.studentId` becomes nullable, plus a new
     `Invoice.admissionApplicationId` (also nullable) — a DB `CHECK` constraint enforces **at
     least one** of the two is set on any row, never neither (corrected in Phase 6's own section
     below from an original "exactly one, never both" draft — the reconciliation step two bullets
     down deliberately leaves both set on a paid, enrolled admission's invoice, which an
     exclusive-or would make illegal). Fee/outstanding-balance queries
     that currently assume every invoice has a `studentId` need a fallback (show the applicant's
     name off the linked `AdmissionApplication` instead) — flag this explicitly when Phase 6 is
     scoped, it's a real query change, not a schema footnote.
   - The `PATCH /admissions/:id { stage: 'fee_payment' }` transition (Phase 6's implementation of
     it — there's no separate "mark fee payment" endpoint, see the real-contract note above)
     generates the real `Invoice` against the tenant's "Admission" `FeeStructure`, with
     `admissionApplicationId` set and `studentId: null`, and stamps the id onto
     `AdmissionApplication.admissionFeeInvoiceId`.
     Payment recording (`POST /fees/invoices/:id/payments`) needs nothing new — it already only
     needs the invoice id.
   - `POST /admissions/:id/enroll` is gated server-side on that invoice's status being `paid`
     (PRD §7's order enforced as a real business rule, not just client stepper sequencing), then
     creates the `Student` row and **reconciles**: every `Invoice` with this
     `admissionApplicationId` gets `studentId` set to the new student's id (keeping
     `admissionApplicationId` too, as the historical link — never overwritten, never cleared).
   - **Phase 3 (now, built)** ships the state-machine shape — the `fee_payment` stage itself
     (reached via the generic `PATCH /admissions/:id`, gated on `admissions.approve` and on
     `decision === 'accepted'` already set — `AdmissionsService`'s `assertStageTransitionAllowed`),
     the `admissionFeeInvoiceId` column, and `enroll`'s stage-gate (`stage === 'enrollment'`
     required) — without the real invoice underneath. The frontend's existing "Confirm payment
     received" placeholder (just another `PATCH` to `stage: 'enrollment'`) is unchanged;
     `admissionFeeInvoiceId` stays `null` until Phase 6 fills it in. This is a genuinely additive
     Phase 6 change, not a rework, because the shape was decided now instead of guessed at twice
     from two different module docs.

2. **RESOLVED/BUILT — the two-step upload flow.** `FileUploadField` consumers (Admissions'
   documents panel, Students' documents tab) stage files before the owning entity exists, so
   there's no `ownerId` yet at upload time. `POST /documents/upload` accepts an optional `ownerId`
   (already true of the frontend's own `documentUploadSchema`) and `PATCH /documents/:id` attaches
   one after the fact — both built and e2e-tested. Not yet called by the frontend, though: `admissions/
api.ts`'s `submitDocuments` still posts plain file names to the placeholder
   `PATCH /admissions/:id/documents` endpoint (also built, matching that existing contract exactly)
   rather than the real upload primitive — wiring `DocumentsPanel`/`StudentForm` to the real
   endpoints is frontend work for a later pass, not blocked on anything backend-side anymore.

**Integration task:** run `frontend`'s existing students/parents/teachers/admissions component and
hook tests against this real backend locally (not just their own mocks) once Postgres/Redis/MinIO
are reachable together — every contract question this phase had is resolved above, so, like Phase
2, what's left is verification, not design.

---

### Phase 4 — Academics ✅ built, backend side confirmed

Pairs with **frontend Phase 4 (done)** — `modules/timetable.md`, `modules/attendance.md`,
`modules/homework.md`.

**Status:** `timetable/`, `attendance/` (+ its `leave/student` controller), and `homework/` all
built, migration `20260907165715_phase4_academics` applied, unit- and e2e-tested against a live
Postgres/Redis (Docker's Postgres container plus a locally-reachable Redis this pass, MinIO not
reachable in this environment — same pre-existing gap Phase 3 documented, and irrelevant here since
nothing in this phase touches object storage: homework/submission attachments stay unwired JSON
placeholders, see below). `test/academics.e2e-spec.ts` (38 tests: full CRUD + permission gating +
tenant isolation for all three modules, the bulk-attendance upsert-in-place behavior, the
analytics/export endpoints, the leave-request ownership check, and the `'me'` idiom's
documented-gap 404 _and_ its resolved-once-linked success path for both `Teacher.userId` and
`Student.userId`). `npm run verify` and the full e2e suite are green except the four pre-existing
MinIO-dependent Documents tests (Phase 3's own documented gap, unrelated to this phase).

**Permission catalog correction:** see the "Phase 4 correction" note earlier in this doc — the
granular strings the built frontend actually calls (`timetable.update` for every timetable
mutation; `homework.create`/`.update`/`.delete` for homework's CRUD) replace the original
`timetable.manage`/`.generate` and `homework.manage` placeholders, seeded and wired into every
controller's `@RequirePermission`.

**The `'me'` idiom, standardized this phase** (attendance, homework, and timetable's own
`teacherId=me`; Phase 7+ modules reusing it — HR & Payroll's `employeeId=me`, Library's portal
`studentId=me` — should call the same helpers rather than reinventing it): implemented once in
`common/identity/resolve-me.ts`, resolving from a new `Student.userId`/`Teacher.userId` (nullable,
unique — same shape as `Parent.userId`). Same documented gap as `Parent.userId`: nothing provisions
either column yet (no student/teacher portal-invite flow exists), so every real caller gets a 404
today — `academics.e2e-spec.ts` proves both states, the 404 and (by writing the link directly, the
way a future invite flow would) the resolved success path, so this needs no further change once
that flow exists.

**Two schema corrections against the real frontend source, same discipline as every earlier
phase's own correction notes:**

- **No separate `Timetable` header entity.** The original entity list above had one;
  `frontend/src/features/timetable/api.ts`'s `TimetableEntry` is the only shape ever fetched or
  written — same "no separate aggregate entity" correction as Phase 3's `AdmissionInquiry`.
- **`Attendance` is `AttendanceRecord`** — matches the frontend's own type name
  (`attendance/api.ts`'s `AttendanceRecord`), not a schema difference, just a naming correction
  against the real contract.

**Endpoints (as actually built):**

```
GET    /timetable                 ?classId=&sectionId= | ?teacherId= (accepts 'me') | ?roomId=
GET    /timetable/entries         full unfiltered collection, for client-side conflict checking
CRUD   /timetable/entries
POST   /timetable/generate        NOT a real constraint solver — a documented, honestly-flagged
                                  round-robin filler over each subject's TeacherAssignment,
                                  avoiding teacher double-booking only; replaces every entry for
                                  the target class/section, synchronous (not a queued job, matching
                                  the frontend's own assumed synchronous response shape)
CRUD   /timetable/substitutions   date-scoped
GET    /attendance                ?classId=&sectionId=&date= | ?studentId= (accepts 'me') +
                                  optional from/to
POST   /attendance/bulk           upserts on [studentId, date] — resubmitting a day corrects it
PATCH  /attendance/:id            attendance.modify
GET    /attendance/analytics      ?scope=daily|weekly|monthly|term&groupBy=student|class|
                                  teacher|branch — 'teacher' groups by the marking teacher
                                  (markedByUserId), 'branch' is one tenant-wide row (see the real,
                                  flagged gap below)
GET    /attendance/export         same params as analytics, CSV
POST   /leave/student             no @RequirePermission — ownership enforced in the service instead
                                  (staff permission, or the caller's own linked child)
GET    /leave/student             ?studentId= (accepts 'me') → plain array; otherwise
                                  ?page=&pageSize=&status= → paged review queue
PATCH  /leave/student/:id         attendance.modify (no dedicated leave-review permission exists,
                                  per this module's own resolved decision)
CRUD   /homework                  teacherId stamped server-side from the session, never client-
                                  supplied; list always includes submissionCount/studentCount
                                  (not just when studentId-scoped — needed for the teacher's own
                                  "18/25 submitted" progress column)
POST   /homework/:id/submissions  student's own submission only, resolved via the 'me' idiom
GET    /homework/:id/submissions  ?studentId= (accepts 'me') → one submission or null; otherwise →
                                  every submission (teacher grading queue)
PATCH  /homework/submissions/:id  homework.grade
```

**Not built this phase, deliberately deferred:** `GET /teachers/me/dashboard` —
`teachers.md`'s own still-open question about aggregation-vs-composed-calls stays open; nothing in
this phase's own contract needed it, and deciding it without real data volumes would be a guess.
Realtime attendance-change notifications (Socket.IO `attendance.updated`) also stay deferred, per
the frontend's own phase-ordering call — the `/ws` gateway lands in Phase 7.7 once communication
work needs it.

**A real, flagged data-model gap found building attendance analytics, not silently
worked around:** `groupBy=branch` has no real data path — `Student`/`SchoolClass`/`Section` carry
no `branchId` anywhere in this schema (branches exist only at the school-setup level, PRD §6,
never linked to academic structure). Rather than fabricating a multi-branch split that isn't there,
this groups every record into one tenant-wide `"All branches"` row — flagged here the same way
`Section.classTeacherName` staying free text was flagged in Phase 2, not fixed silently. Linking
`Student`/`SchoolClass` to a real `Branch` is a schema change for whichever phase first needs
genuine per-branch attendance reporting.

**Integration task:** run `frontend`'s existing timetable/attendance/homework component and hook
tests against this real backend locally (not just their own mocks) — every contract question this
phase had (the `'me'` idiom's shape, the permission strings, the six-day-week assumption baked
into `generate()`) is resolved above, so, like Phases 2 and 3, what's left is verification, not
design.

---

### Phase 5 — Examinations ✅ built, backend side confirmed

Pairs with **frontend Phase 5 (done)** —
[`frontend/modules/examinations.md`](../frontend/modules/examinations.md).

**Status:** `examinations/` built (`src/examinations/`), migration `20260907192841_phase5_examinations`
applied, e2e-tested against a live Postgres/Redis (`test/examinations.e2e-spec.ts`: 23 tests —
exam CRUD + permission gating + tenant isolation, the marks-entry-sheet roster, bulk marks
submission with cross-field/max-marks/roster validation and upsert-in-place correction, grade/GPA/
rank computation, the publish lock and its `results.publish`-holder reopen override, and the
report-card endpoint's own ownership + publish-state access control for both a linked student and
a linked parent). `npm run verify` green; the full e2e suite is green except the pre-existing
MinIO-unreachable-in-this-environment gap (`documents`/`people-documents.e2e-spec.ts` — Phase 3's
own documented gap, unrelated to this phase, nothing here touches object storage) and one
already-failing `health.e2e-spec.ts` assertion from the same MinIO gap.

**Two schema corrections against the real frontend source, same discipline as every earlier
phase's own correction notes:**

- **No separate `Mark`/`Result`/`Grade`/`ReportCard` entities.** This plan's original Phase 5
  entity list had all four; `features/examinations/api.ts`'s `ExamResultRow`/`ReportCard` shapes
  are entirely server-computed from one `ExamMark` row per `(exam, student)` plus a fixed grading
  scale, never stored — same "no separate aggregate entity" correction as Phase 3's
  `AdmissionInquiry` / Phase 4's `Timetable` header entity.
- **Report cards group sibling `Exam` rows, they're not one `Exam` row.** `examSchema`'s
  `subjectId` is a single field — an `Exam` is one subject's sitting, not a multi-subject exam
  period — but `ReportCard.subjects[]` is multi-subject. `examinations.service.ts`'s
  `getReportCard` resolves this by treating every `Exam` sharing the same `(type, classId,
sectionId)` as one series (e.g. every "Midterm" exam for class 7-A across subjects); there is no
  separate `ExamSeries`/`ExamGroup` entity, the grouping key is computed at read time. `examName`
  (present on `ReportCard` but not on `Exam` itself, which has no name field) is the exam type's
  display label (`EXAM_TYPE_LABELS`, mirroring the frontend's own map).

**Permission catalog correction (same pattern as every earlier phase's own row):** the
`exams.manage`/`marks.enter` placeholders are replaced by the granular strings the actually-built
frontend calls (`ExamsTable.tsx`'s `usePermission('exams.update'/'results.enter'/'results.read')`,
`ExamsListPage.tsx`'s `usePermission('exams.create')`, `ResultsPage.tsx`'s
`usePermission('results.publish')`) — `exams.read` is kept (gates `GET /exams`/`GET /exams/:id`
server-side) even though nothing client-side checks it before rendering the list, same
"not client-gated but still enforced" reasoning as Phase 4's `homework.grade`. `prisma/seed.ts`
now seeds the corrected strings.

**Two real design decisions this phase had to make that the frontend's assumed contract doesn't
fully settle, both flagged rather than guessed silently:**

- **Grading scale.** PRD §16 lists "Grade calculation"/"GPA"/"Percentage" as features but specifies
  no actual scale, and `school-setup.md`'s own "Grading systems" config screen is deferred —
  `examinations.md`'s "Open questions" already flags this exact gap ("re-verify once the school's
  grading-system config... actually exists"). `src/examinations/grading-scale.ts` implements **one
  fixed percentage → grade/GPA scale, applied tenant-wide** (an eight-band A+–F scale, 4.0 GPA) —
  a real, honestly-flagged placeholder, same standard as `timetable.service.ts`'s `generate()`
  filler — not a per-school setting invented to look configurable. Swap for a real per-tenant
  lookup once that config screen ships; nothing downstream needs to change shape when it does.
- **Marks-lock reopen.** `examinations.md`'s "Marks entry" section says publish "locks further
  marks edits unless re-opened by an authorized role," but the frontend's built contract
  (`api.ts`) has no separate unlock/reopen endpoint. Resolved by treating `results.publish` itself
  as the override: `POST /exams/:id/marks` 409s once `Exam.isPublished` is true unless the caller
  holds `results.publish`, in which case the edit goes through anyway. No new endpoint, no schema
  change — see `Exam.isPublished`'s own schema doc comment.
- **Report-card access control** (the one endpoint shared by the back office and the Parent/
  Student portal — `PortalResultsPage`'s own comment: "whether an exam's results are actually
  published yet is left to the report-card endpoint itself to enforce"): no `@RequirePermission`
  on `GET /report-cards/:studentId` (portal callers hold zero permissions in the seeded catalog,
  same reasoning `LeaveController`'s shared `/leave/student` routes already document) — a caller
  holding `results.read` gets any student's card regardless of publish state (the staff-preview
  case); everyone else must own the record (the student themselves via `Student.userId`, or a
  linked parent via `Parent.userId`/`ParentStudentLink` — the same `assertCanActForStudent`
  ownership pattern `LeaveService` already uses) **and** the anchor exam must be published.

**Module:** `examinations/`.

**Entities:** `Exam` (single-subject, `isPublished` flag — see the schema corrections above),
`ExamMark` (one row per student per exam, no explicit `tenant` relation, same high-volume-leaf
trade-off `AttendanceRecord`/`HomeworkSubmission` already make).

**Endpoints (as actually built):**

```
GET   /exams                      ?classId=&sectionId= | ?studentId= (accepts 'me', portal) —
                                  paginated, exams.read
GET   /exams/:id                  exams.read
POST  /exams                      exams.create
PATCH /exams/:id                  exams.update — 409s if the exam is published and the caller
                                  lacks results.publish (same lock/override as marks, below)
GET   /exams/:id/marks-entry-sheet one row per student enrolled in the exam's class/section,
                                  pre-filled from any ExamMark already entered — results.enter
POST  /exams/:id/marks            bulk upsert on [examId, studentId] — resubmitting corrects in
                                  place; rejects a record missing both marks and isAbsent, marks
                                  over maxMarks, and a student outside the exam's class/section;
                                  409s once published unless the caller holds results.publish —
                                  results.enter
GET   /exams/:id/results          grade/GPA/rank — server-computed, standard competition ranking
                                  (ties share a rank, absent/ungraded students are null-ranked,
                                  never last-place) — results.read
POST  /exams/:id/publish          sets isPublished — results.publish
GET   /report-cards/:studentId    ?examId= — accepts 'me' in the path; no route-level permission
                                  gate, see the report-card access-control decision above
```

**Not built this phase, deliberately deferred:** transcripts (multi-term/multi-year summary) stay
Phase 7+/reports scope, per `examinations.md`'s own resolved note — this phase's report card is
per-exam-series only. Online Examination (§17: question bank, MCQ/timed/auto-graded) is out of
scope entirely, same resolved note. A real browser print-preview check of `ReportCardPage` against
this live data is still a manual step (`examinations.md`'s own definition of done) — not something
this phase's automated e2e coverage can substitute for.

**Integration task:** run `frontend`'s existing examinations component/hook tests against this real
backend locally (not just their own mocks) once Postgres/Redis are reachable together — every
contract question this phase had (the grading scale, the report-card series grouping, the marks
lock/reopen, the report-card access model) is resolved above, so, like Phases 2–4, what's left is
verification plus the one manual print-preview check, not design.

---

### Phase 6 — Finance ✅ built, backend side confirmed

Pairs with **frontend Phase 6 (done) — closes the PRD §65 MVP on the frontend side.**
[`frontend/modules/fees.md`](../frontend/modules/fees.md).

**Status:** `fees/` (fee structures, invoices, payments, outstanding) and `search/` built
(`src/fees/`, `src/search/`), migration `20260907195655_phase6_fees` applied, unit- and
e2e-tested against a live Postgres/Redis (`test/fees.e2e-spec.ts`: 33 tests — fee-structure CRUD

- permission gating + tenant isolation, single-student and bulk-by-class invoice generation with
  server-computed discount math, payment recording/refund with real `paidAmount`/`status`
  recomputation, the fee-structure delete-blocked-while-invoices-exist guard, outstanding-balance
  rollups by student and by class, and `/search`'s per-category permission gating). This phase also
  required touching `test/people-documents.e2e-spec.ts`'s own Phase 3 "Admissions (full
  pipeline...)" suite — see the admissions↔fees integration note below — which is why that file's
  own test count grew this phase, not just this one. `npm run verify` green; the full e2e suite is
  green except the four pre-existing MinIO-unreachable-in-this-environment Documents tests (Phase
  3's own documented gap, unrelated to this phase) and the one `health.e2e-spec.ts` assertion that
  depends on the same gap. A real `nest build` + `node dist/main` boot was curl-verified (helmet
  headers, `/docs`, and 401s on every new route with no token, confirming the new
  `FeesModule`/`SearchModule`/`AdmissionsModule → FeesModule` wiring has no circular-DI issue).

**A real bug in this plan's own two earlier passages, caught and fixed before it shipped:** this
section's own "Entities" row (below) and the Phase 3 "RESOLVED" note above both said the
`Invoice.studentId`/`admissionApplicationId` CHECK constraint enforces "exactly one... never both,
never neither" — but that same Phase 3 note's own reconciliation step says `enroll()` backfills
`studentId` onto a paid admission invoice **without clearing** `admissionApplicationId` ("keeping
admissionApplicationId too, as the historical link — never overwritten, never cleared"). An
exclusive-or constraint makes that documented reconciled state illegal. Built the constraint as
"at least one, never neither" instead (`invoices_student_or_admission_check` in this phase's
migration SQL) — every invoice naturally has exactly one set except a reconciled post-enrollment
admission invoice, which legitimately has both; see `Invoice`'s own schema.prisma doc comment.
Caught before any real data existed against the stricter version, so fixing it was a
`prisma migrate reset` (user-confirmed — local dev DB only) rather than a follow-up migration.

**Accounting is not built this phase — a correction to this section's own original "Modules"
line**, not a scope cut discovered late: `frontend/modules/fees.md`'s own "Open questions" already
resolved this ("Accounting... is materially larger than fee collection — confirmed Phase 7+, don't
let it creep into this phase's scope"), and that module doc's endpoint list has zero accounting
routes. This section's original draft carried an aspirational `accounting/` line anyway, predating
that resolution — removed here rather than built out into an endpoint nobody's asked for, per this
plan's own stated philosophy in its introduction.

**The admissions↔fees ordering integration (Phase 3's resolved decision) is wired end-to-end,
not just schema-ready:** `AdmissionsService.update` now calls `InvoicesService.generateAdmissionInvoice`
when a `PATCH /admissions/:id` transition lands on `fee_payment` — it looks up the tenant's
`type: 'admission'` `FeeStructure` applicable to the applicant's target class (400s with a clear
message if none is configured yet, rather than silently skipping), generates a real `Invoice`
(`studentId: null`, `admissionApplicationId` set, due immediately), and stamps the id onto
`admissionFeeInvoiceId`. `AdmissionsService.enroll` now 400s unless that invoice's status is
`paid`, then — inside the same transaction that creates the `Student` — calls
`InvoicesService.reconcileAdmissionInvoices` to backfill `studentId` onto every invoice carrying
that `admissionApplicationId`, keeping `admissionApplicationId` too. `AdmissionsModule` imports
`FeesModule` (exports `InvoicesService`) for this — one-directional, `FeesModule` knows nothing
about admissions. This is also why `test/people-documents.e2e-spec.ts`'s own admissions-pipeline
test changed this phase: it previously asserted `enroll()` succeeds with no fee structure or
payment involved at all, which is no longer true once this integration is real — updated to seed
an admission `FeeStructure` and record a real payment before enrolling, and to assert the
too-early-enroll 400 and the reconciled invoice's final `studentId`/`admissionApplicationId` state.

**A real, honestly-flagged simplification against this section's own original endpoint note, not
a silent downgrade:** `GET /search` is Postgres `ILIKE` (`contains`/`insensitive`) across
students/teachers/parents/admissions/invoices, not the `tsvector` + GIN full-text index this
section originally specified. At current school-scale row counts this is fast enough and needed
zero new schema; swap for real full-text (the tech-stack table's own noted fallback path,
"Meilisearch/OpenSearch stays a later swap if search quality becomes a real complaint") once
result relevance or query volume actually demands it — nothing about the endpoint's request/
response shape needs to change when that happens. Each result category is gated on that
category's own read permission (`fees.read` for invoices, `students.read` for students, etc.), not
on the route itself — same shared-route pattern `LeaveController`/`ReportCardsController` already
use — so a caller only ever sees categories their role could otherwise read.

**A real design decision on refunds' effect on invoice status, not explicit in either module
doc:** `fees.md` says refunds are all-or-nothing but doesn't say what a refund does to the
invoice's displayed status. Resolved by recomputing `paidAmount`/`status` from every
**non-refunded** `Payment` row every time one is recorded or refunded (`InvoicesService.
recomputeInvoiceTotals`) — a refunded payment simply drops out of the sum, so a `paid` invoice
with its only payment refunded goes back to `pending`, not to some new "refunded" invoice status
(`InvoiceStatus` has no such member — refund state lives entirely on `Payment.refunded`).

**Module:** `fees/` (fee structures, invoices, payments, outstanding), `search/`.

**Entities:** `FeeStructure` (`discountRules` JSON, same trade-off as `Student.
emergencyContacts`), `Invoice` (`studentId` nullable + a new `admissionApplicationId` nullable, DB
`CHECK` enforcing **at least one** is set, not exactly one — see the corrected note above),
`Payment` (`refunded`/`refundedAt`, no separate `Refund` entity — a refund is a flag on the
`Payment` it reverses, not its own row, since refunds are all-or-nothing per `fees.md`'s own
resolved scope). No separate `Discount`/`Scholarship` entities — `FeeStructure.discountRules` JSON
covers both, same reasoning `school-setup.md`'s nested-array resolution already established.

**Endpoints (as actually built):**

```
CRUD /fees/structures                fees.create gates both create and edit (no separate
                                      fees.update in the seeded catalog — matches
                                      FeeStructuresTable.tsx's own usePermission('fees.create')
                                      covering both actions)
POST /fees/invoices                  single student or bulk-by-class (mode: 'student'|'class');
                                      400s if the fee structure doesn't apply to the target class
                                      (FeeStructure.applicableClasses)
GET  /fees/invoices, /fees/invoices/:id   ?studentId=&classId=&status=
POST /fees/invoices/:id/payments     fees.collect; body invoiceId must match the route (same
                                      "route id wins" convention as ExaminationsService's examId)
POST /fees/payments/:id/refund       fees.refund; 409s if already refunded
GET  /fees/payments, /fees/payments/:id/receipt
GET  /fees/outstanding               ?groupBy=student|class; groups an admission-linked invoice
                                      (studentId: null) by its AdmissionApplication's applicant
                                      name instead of a missing student record
GET  /search?q=&type=                ILIKE across students/teachers/parents/admissions/invoices,
                                      not full-text — see the flagged simplification above; each
                                      category gated on that category's own read permission
```

**Integration task — this is the MVP milestone.** Once `frontend`'s Phase 6 screens are
re-verified against these real endpoints (fee structures → invoice → payment → receipt →
outstanding-balances dashboard, plus `CommandPalette`'s real `/search`), **PRD §65's MVP is
genuinely end-to-end**, not just frontend-complete-against-assumptions — verify the full flow
together (admission → enrollment → attendance → homework → exam → fee payment), not each module in
isolation, per the frontend plan's own call-out. `frontend/src/features/fees/api.ts`'s `Invoice`
type is currently typed `studentId: string` (non-nullable); this backend honestly returns
`string | null` for a pre-enrollment admission invoice — `fees.md`'s own "Open questions" already
flagged this exact frontend-side follow-up as non-blocking, still true here.

---

### Phase 7+ — Backlog modules

The frontend already shipped **every one of these** (except AI Assistant) against assumed
contracts. Build the backend in the same order the frontend already established, so each
integration pass has a finished, waiting frontend rather than the reverse:

#### 7.1 — Documents & Certificates ✅ built, backend side confirmed (do early — Phase 3 already needs the base upload endpoint)

[`modules/documents-certificates.md`](../frontend/modules/documents-certificates.md)

**Status:** the documents/ storage half needed nothing new — Phase 3's `POST /documents/upload` /
`GET /documents?category=&ownerId=` / `GET /documents/:id/versions` already are this module doc's
"Backend dependencies" list verbatim, confirmed again this phase rather than re-guessed. The actual
new work is `certificates/` (`src/certificates/`): template selection, dynamic-field validation,
real PDF generation (`pdf-lib` + `qrcode`, newly added dependencies — no existing PDF/QR library in
this codebase), object storage, and the public QR-verify lookup. Migration
`20260907205316_phase7_1_documents_certificates` applied; `test/certificates.e2e-spec.ts` (10
tests: per-template required-field validation including the `custom`-needs-`customTitle` case,
tenant isolation on `studentId`, permission gating, a real PDF-generation-and-storage round trip
asserting actual `%PDF` magic bytes at the signed URL — not just a well-formed URL string — and the
public verify endpoint with **no `Authorization` header sent at all**, both the valid-code and
unknown-code-404 cases). `npm run verify` green; the **full e2e suite (152 tests, all 8 spec
files) is green against a genuinely live Postgres/Redis/MinIO stack** — see the MinIO note below,
this is the first phase where that's true without a caveat.

**A real infra bug found and fixed, not just this phase's own code:** every earlier phase's status
notes ("MinIO not reachable in this environment") turned out to be one root cause, not an
environment limitation to keep working around — something outside Docker on the dev machine this
was built on was already bound to host port 9000 (and 6379, coincidentally harmless there since a
native Redis on that port serves the same purpose), silently swallowing `docker compose up -d`'s
minio container start (`docker ps` showed it `Created`, never `Running`, easy to miss). Fixed by
remapping MinIO's host-side ports to 19000/19001 in `docker-compose.yml` (the container's own
internal ports are unchanged) and updating `S3_ENDPOINT` in `.env`/`.env.example` to match — see
that file's own comment. This is why this phase is the first one able to actually verify a real
upload → storage → signed-URL → byte-for-byte download round trip in this environment instead of
documenting it as a gap; worth re-running Phase 3–6's own e2e suites after this fix too (done — all
152 tests across every phase's spec file pass together now).

**Certificate dynamic fields — resolved, not left open:** kept the frontend's fixed
`CERTIFICATE_TEMPLATE_FIELDS` set, mirrored server-side (`certificates/certificate-templates.ts`)
and enforced as a real required-field check in `CertificatesService`, not just a client-side form
convenience — same "real, honestly-flagged placeholder" standard `examinations/grading-scale.ts`'s
fixed grading scale already set, not a template-config endpoint nobody asked for. Swap for a real
per-tenant/template-config lookup later; nothing downstream needs to change shape when that
happens.

**Two real design decisions this phase had to make that neither module doc fully settles, both
flagged rather than guessed silently:**

- **`verifyCode` vs. `certificateNumber` are deliberately two different values**, not one —
  `certificateNumber` is the human-displayed, printed identifier; `verifyCode` (higher entropy,
  `randomBytes(16)`) is the only thing standing between "read this certificate holder's name with
  no login" and a real access control, since `GET /certificates/verify/:code` is genuinely public.
  See `Certificate.verifyCode`'s own schema.prisma doc comment.
- **The verify lookup needed a new sanctioned `PlatformPrismaService` call site** — a public,
  unauthenticated QR scan has no per-request tenant in context at all (not even a wrong one), so it
  can't go through the normal tenant-scoped `PrismaService` (`tenant-scoping.ts` fails closed on a
  missing tenant, by design). This is a third sanctioned use, alongside the two
  `platform-prisma.service.ts`'s own doc comment already lists (auth's pre-tenant-context user
  lookups, the Phase 7.9 Platform Console) — flagged here and in that file's own comment rather than
  silently added as a fourth undocumented one.

**Not built this phase, deliberately deferred, same discipline as every earlier phase's own
"flag, don't guess" calls:**

- **§26's audited-access-reason requirement for medical documents** (an access-reason prompt beyond
  normal RBAC) — still open on both sides, needs a real product conversation about what that UX
  looks like before either side builds it.
- **A logo/letterhead image on the generated PDF** — `renderCertificatePdf` renders school-name
  text branding only; embedding `School.logoUrl` (an arbitrary stored URL) would mean this service
  fetching an external URL server-side on every generate call, new outbound-request surface
  (`security-standards`' SSRF guidance) for a purely cosmetic addition nobody asked for. Revisit
  once school-profile logo uploads go through the `documents/` primitive instead of a free-text
  URL — see `certificate-pdf.ts`'s own doc comment.
- **A `GET /certificates/:id` single-get endpoint** — `certificates/api.ts` never calls one
  (`CertificateTable`'s row actions link straight to `pdfUrl`/the verify link from the list
  response), so none was built; additive if a later screen needs it.

**Module:** `documents/` (unchanged, Phase 3), `certificates/`.

**Entities:** `Document`, `DocumentVersion` (unchanged, Phase 3), `CertificateTemplate`,
`Certificate` (`studentId` a real FK — unlike `AdmissionApplication.admissionFeeInvoiceId`, this
entity didn't predate the thing it references).

**Endpoints (as actually built):**

```
GET  /documents?category=&ownerId=   unchanged, Phase 3
GET  /documents/:id/versions         unchanged, Phase 3
GET  /certificates                    ?studentId= — certificates.read
POST /certificates/generate           template + dynamic fields → real PDF, QR, unique cert
                                      number — certificates.generate; 400s on a missing required
                                      template field or a missing customTitle for `custom`
GET  /certificates/verify/:code       PUBLIC, unauthenticated (@Public(), no session required) —
                                      matches the frontend's own bare-axios (non-apiClient) call;
                                      404s an unknown code rather than a `{ valid: false }` 200
```

**Integration task:** run `frontend`'s existing documents/certificates component and hook tests
against this real backend locally (not just their own mocks) — every contract question this phase
had (dynamic fields, the verify lookup's access model) is resolved above, so, like Phases 2–6,
what's left is verification, not design. Wiring the existing `FileUploadField` consumers (Students,
Admissions, Homework, Transport) to the real `POST /documents/upload` — this module doc's own
long-standing "Open questions" item — is still open, and still frontend work, not blocked on
anything backend-side.

#### 7.2 — Library ✅ built, backend side confirmed

[`modules/library.md`](../frontend/modules/library.md)

**Status:** every endpoint `api.ts` assumes is built (`src/library/`, five controller/service pairs
by concern — catalog, members, settings, circulation, reservations — sharing the `library`/
`library/members`/`library/settings`/`library/reservations` prefixes). Migration
`20260908183840_library_phase_7_2` applied; `test/library.e2e-spec.ts` (22 tests: catalog CRUD +
tenant isolation, member creation against a real `Student` row, issue/return with a server-computed
due date and an actually-overdue fine (backdated `dueAt`, not a real multi-day wait) capped at
`maxFine`, pay/waive, the reservation FIFO queue surfacing as a copy's `nextReservation` once
returned, atomic fulfill-issues-and-marks-fulfilled, and the portal's self-service reserve/cancel +
`studentId=me` loans read) all green against live Postgres/Redis. `npm run verify` green.

**One entity-list correction against what the frontend actually built, same "corrected against the
real built frontend" discipline every earlier phase's own status note applied:** no separate `Fine`
model — `api.ts` never has one; a fine is just `Loan.fineAmount`/`.fineStatus`, and
`GET /library/fines` is `GET /library/loans` filtered to `fineStatus != none`. See
`schema.prisma`'s own "Library" section header comment.

**Real design decisions this phase had to make that the module doc leaves as open questions,
flagged rather than guessed silently:**

- **Portal self-service reservations auto-provision a `LibraryMember`** — `createReservationForStudent`
  never learns its own `LibraryMember.id` (module doc's own note), so `LibraryMembersService.
findOrCreateForStudent` creates one on first use with the same `maxBooks: 3`/`loanPeriodDays: 14`
  defaults `MemberForm`'s own form defaults use — there's no other source of truth for a student's
  lending limits until a librarian sets one explicitly.
- **One endpoint, two callers, no route-level permission gate** — `POST/GET /library/reservations`
  and `POST .../cancel` carry no `@RequirePermission`, same `attendance/leave.controller.ts`
  `POST /leave/student` precedent: a librarian caller (`memberId`) is checked against
  `library.circulate` in the service, a portal caller (`studentId`) against the same
  self-or-linked-parent ownership `LeaveService.assertCanActForStudent` already established.
- **`fulfill` is not one DB transaction across issue-the-copy and mark-the-reservation-fulfilled**
  — `issueBook` already runs its own `$transaction` for the loan+copy half; a real, flagged limit
  (see `LibraryReservationsService.fulfill`'s own doc comment), not an oversight.

**Not built this phase, deliberately deferred:** the real `readyAt`/`expiresAt` fields on
`Reservation` the frontend's own hold-expiry countdown (`lib/reservationExpiry.ts`) is waiting on —
adding them (plus, ideally, a server-side auto-cancel job for expired holds) is additive, no
existing shape needs to change when it happens.

- **Module:** `library/`.
- **Entities:** `Book`, `BookCopy`, `LibraryCategory`, `LibraryShelf`, `LibraryMember`, `Loan`
  (carries the fine fields — see correction above), `Reservation`, `LibrarySettings`.
- **Endpoints (as actually built):**
  ```
  CRUD /library/books, /library/categories, /library/shelves
  CRUD /library/books/:bookId/copies
  GET  /library/books/:id
  CRUD /library/members
  GET  /library/copies/lookup?barcode=      returns nextReservation when relevant
  POST /library/issue
  POST /library/return                       computes fineAmount server-side
  GET  /library/fines
  POST /library/fines/:loanId/pay
  POST /library/fines/:loanId/waive
  GET/PATCH /library/settings                { finePerDayRate, maxFine }
  GET  /library/reservations                 + studentId filter (portal)
  POST /library/reservations                 { bookId, memberId } or { bookId, studentId }
  POST /library/reservations/:id/cancel
  POST /library/reservations/:id/fulfill      atomic-per-write: issues a copy + marks fulfilled
  GET  /library/loans?studentId=              'me' idiom
  ```
- **Integration task:** run `frontend`'s existing library component/hook tests against this real
  backend locally (not just their own mocks) — every contract question this phase had is resolved
  above, so what's left is verification, not design. Add the real `readyAt`/`expiresAt` fields (see
  "Not built" above) whenever hold-expiry is prioritized.

#### 7.3 — Transport (vehicle/route management; live tracking is its own sub-phase)

[`modules/transport.md`](../frontend/modules/transport.md)

- **Module:** `transport/`.
- **Entities:** `Vehicle`, `MaintenanceRecord`, `Route`, `RouteStop`, `TransportAssignment`.
- **Endpoints:**
  ```
  CRUD /transport/vehicles
  CRUD /transport/routes
  ```
- **Not this sub-phase:** live GPS WebSocket channel, geofencing, pickup/drop-off confirmation,
  arrival/emergency notifications — the frontend explicitly deferred `LiveTrackingMap` pending a
  mapping-library decision; don't build the realtime channel until that's picked (backend and
  frontend should make this decision together, since it affects the WS payload shape).
- **Integration task:** add a batch student-lookup-by-ids endpoint if route detail's "Students" tab
  needs resolved names instead of just a count (flagged as a nice-to-have, not required).

#### 7.4 — Inventory & Assets ✅ built, backend side confirmed

[`modules/inventory.md`](../frontend/modules/inventory.md)

**Status:** `inventory/` built (`src/inventory/stock/`, `src/inventory/assets/` — split by concern,
same convention `TransportModule`'s `vehicles/`/`routes/` already set), migration
`20260909164751_phase7_4_inventory_assets` applied, e2e-tested against a live Postgres/Redis
(`test/inventory.e2e-spec.ts`: 26 tests — stock category add/delete, stock item CRUD with a
server-ignored `quantity` on update, the movement log applying a signed delta and rejecting both a
below-zero result and a zero-quantity movement, asset CRUD with wholesale-replaced maintenance
records and the disposed-without-a-disposal-date 400, and tenant/permission isolation for both
`inventory.*` and `assets.*` — they're separate permission pairs, so a caller with only one set is
exercised against the other's routes too). `npm run verify` green; the full e2e suite is green
except one **pre-existing, unrelated** failure in `academics.e2e-spec.ts` ("analytics groups by
class") — that spec hardcodes attendance on `2026-09-07`/`08` and asserts a `scope: daily` (i.e.
today) query sees it, which drifts false once the real calendar date moves past those — a Phase 4
test-data bug, not touched by this phase and not fixed here (out of scope). A real `nest build` +
`node dist/main` boot was curl-verified (401 with the standard error shape on both new route
groups with no token, `/docs` 200, every route logged at startup).

**A real bug in this plan's own original draft, caught before it shipped:** the entity list above
implied `Asset.status` would be a Prisma enum like every other status field in this schema
(`ASSET_STATUSES` in `frontend/schemas.ts` reads exactly like an enum candidate). It isn't one:
those literals are hyphenated (`"in-use"`, `"in-storage"`, `"under-maintenance"`, `"disposed"`),
and Prisma enum _member names_ can't contain a hyphen. The first pass used `@map` on each enum
value to translate — which turned out to only rename the **database** representation, not the
value Prisma Client actually reads/writes in TypeScript (the generated client's `AssetStatus.in_use`
evaluates to `"in_use"`, not `"in-use"`), so `@IsEnum`/every response would have round-tripped the
wrong string and silently broken the frontend contract. Caught before the migration shipped (a
local `prisma migrate reset`, user-confirmed, no real data at stake — same discipline as Phase 6's
own caught-before-it-shipped constraint fix); `Asset.status` is a plain `String` column instead,
validated at the application layer (`ASSET_STATUSES`/`@IsIn` in `assets/dto/asset.dto.ts`), same
"peer entity, no DB-level constraint" trade-off `Book.categoryId`/`.shelfId` already make. Worth
flagging generally: `@map` on a Prisma enum value is a database-rename tool, not a wire-format
translation layer — don't reach for it to bridge a frontend contract with hyphens or other
enum-illegal characters in its literals.

**Module:** `inventory/` (`stock/`, `assets/`).

**Entities:** `StockCategory`, `StockItem`, `StockMovement`, `Asset` (`status` a validated plain
string, not a Prisma enum — see the bug note above), `AssetMaintenanceRecord`.

**Endpoints (as actually built):**

```
GET/POST      /inventory/stock-categories     add/delete-only reference list, no update endpoint —
                                              matches api.ts exactly, same shape as
                                              LibraryCatalogService's categories/shelves
DELETE        /inventory/stock-categories/:id
CRUD          /inventory/stock                ?categoryId=&search= filter; quantity accepted on
                                              create but ignored on update — inventory.manage
GET           /inventory/stock/:id/movements  most-recent-first
POST          /inventory/stock/:id/movements  the only way quantity changes — applies the
                                              (already-signed) quantityChange to StockItem.quantity
                                              in the same transaction that logs it; 400s a movement
                                              that would take stock negative or a zero-quantity one
CRUD          /assets                         top-level prefix, not /inventory/assets — matches
                                              api.ts exactly; maintenanceRecords replaced wholesale
                                              on every write; assets.manage
```

**Integration task:** run `frontend`'s existing inventory component/hook tests against this real
backend locally (not just their own mocks) — every contract question this phase had (the
quantity-is-log-only rule, the disposal-date business rule, the `AssetStatus` hyphen fix above) is
resolved above, so, like every other confirmed phase, what's left is verification, not design.

#### 7.5 — Hostel ✅ built, backend side confirmed

[`modules/hostel.md`](../frontend/modules/hostel.md)

**Status:** `hostel/` built — four controller/service pairs by concern, same split-by-concern
convention `LibraryModule` already set: `hostel-structure` (hostels + rooms + `available` +
`occupancy`), `hostel-allocations`, `hostel-visitors`, `hostel-complaints`. Migration
`20260909171152_phase7_5_hostel` applied, e2e-tested against a live Postgres/Redis
(`test/hostel.e2e-spec.ts`: 42 tests — hostel/room CRUD with the room-delete-blocked-while-occupied
and hostel-delete-blocked-while-rooms-exist guards, `available`/`occupancy` server-computed reads,
the allocate → reassign → vacate lifecycle (bed-range, bed-clash, and already-resident/
already-vacated guards, plus re-allocating a freed student), visitor check-in/out, complaint create
(with/without a room or resident) + status resolution, and tenant/permission isolation —
`hostel.allocate` is exercised as a separate permission from `hostel.manage`). `npm run verify`
green; the full e2e suite is green except the one **pre-existing, unrelated** `academics.e2e-spec.ts`
date-bomb failure Phase 7.4's own status note already flagged (not touched here). A real
`nest build` + `node dist/main` boot was curl-verified (401 on both new route groups with no token,
every route logged at startup).

**A design decision this phase had to make that the module doc leaves as an open question, flagged
rather than guessed silently:** a student allocated to a bed can't be allocated to a second bed
elsewhere at the same time — `POST /hostel/allocate` 409s if the student already holds an active
allocation, matching this module doc's own resolved call that a same-room bed swap isn't supported
either ("use vacate + re-allocate for that rarer case"). Neither module doc nor the PRD states this
explicitly, but two simultaneous beds for one resident isn't a real state a hostel roster should
ever show — see `HostelAllocationsService.assertStudentNotAlreadyResident`'s own doc comment.

**A second lesson from Phase 7.4's `AssetStatus` bug, applied proactively here:** `Complaint.status`
(`schemas.ts`'s `COMPLAINT_STATUSES` includes `"in-progress"`, hyphenated) is a plain `String`
column with `@IsIn` validation, not a Prisma enum — same reasoning as `Asset.status`, caught before
writing the schema this time instead of after. `AllocationStatus`/`HostelType`/`RoomType`/
`ComplaintCategory` have no hyphens in their frontend literals, so those stayed real Prisma enums.

**Two real data-modeling calls, both flagged rather than guessed:**

- **`Allocation.studentLabel` is never client-supplied**, resolved live from the real `Student` row
  every time — `api.ts`'s `createAllocation` payload deliberately drops
  `AllocationFormValues.studentLabel` before the request goes out, so there's nothing to trust even
  if it wanted to. **`Visitor.residentLabel`/`Complaint.residentLabel` are the opposite** — `api.ts`'s
  `checkInVisitor`/`createComplaint` genuinely forward the form's `residentLabel` as-is, so those
  are stored as client-supplied denormalized snapshots (same trade-off `LibraryMember.personLabel`
  already makes), while `residentStudentId` is still validated against a real `Student` row.
- **`Allocation.allocatedAt`/`.vacatedAt` are date-only** (`@db.Date`, matching this schema's own
  `Loan.issuedAt`/`.returnedAt` precedent for a "since when" resident-facing date), while
  **`Visitor.checkInAt`/`.checkOutAt` and `Complaint.createdAt`/`.resolvedAt` are full timestamps**
  — a visitor log and a complaint's audit trail record the actual time, not just the day.

**Not built this phase, per the module doc's own explicitly deferred scope:** hostel-specific
attendance (needs its own marking UI, treated as its own sub-phase); a self-service portal view
(hostel isn't in the Portals table). **Hostel fee linkage stays unresolved on both sides** — no
frontend wiring exists for it (`hostel.md`'s own open question), so nothing was built here either;
still needs a joint decision with `fees/` before either side scopes it. **The school-level
feature-flag gating question** (not every tenant is a boarding school) also stays open — a
`platform/feature-flags` catalog entry for Phase 7.9, not a `hostel/` module change.

**Module:** `hostel/` (`hostel-structure`, `hostel-allocations`, `hostel-visitors`,
`hostel-complaints`).

**Entities:** `Hostel`, `Room` (`floorLabel` a plain field, no separate Floor entity — matches the
frontend's collapsed `hostel → room → bed` hierarchy), `Allocation` (`status` a real Prisma enum),
`Visitor`, `Complaint` (`status` a validated plain string, not a Prisma enum — see the bug-avoidance
note above). **No `Bed` entity** — a room's `capacity` is its bed count; occupancy is derived from
active allocations server-side (`GET /hostel/rooms/:id/occupancy`), matching `lib/occupancy.ts`'s
frontend logic exactly so the two never disagree about which beds are free.

**Endpoints (as actually built):**

```
CRUD /hostel/hostels                  hostel.manage gates mutations; delete 409s while rooms exist
CRUD /hostel/rooms                    ?hostelId=&search=; delete 409s while an active resident
                                      remains; occupiedBeds always server-computed
GET  /hostel/rooms/available?hostelId= rooms with at least one free bed, not paginated
GET  /hostel/rooms/:id/occupancy      AllocationDesk's bed grid
GET  /hostel/allocations              ?hostelId=&status=
POST /hostel/allocate                 hostel.allocate; 400s an out-of-range bed or missing student,
                                      409s an already-occupied bed or an already-resident student
PATCH /hostel/allocations/:id/reassign hostel.allocate; same bed-range/bed-clash checks as allocate
POST /hostel/allocations/:id/vacate   hostel.allocate; 409s an already-vacated allocation
GET/POST /hostel/visitors             ?open=true|false (string, not a real boolean query param)
POST /hostel/visitors/:id/check-out   409s an already-checked-out visitor
CRUD /hostel/complaints (no DELETE)   PATCH takes { status, resolutionNotes }; resolvedAt tracks
                                      the current resolved state, not a one-way flag
```

**Integration task:** run `frontend`'s existing hostel component/hook tests against this real
backend locally (not just their own mocks) — every contract question this phase had (the
already-resident guard, the `Complaint.status` hyphen avoidance, the client-supplied-vs-resolved
label split) is resolved above, so, like every other confirmed phase, what's left is verification,
not design. The fee-linkage and feature-flag-gating questions remain genuinely open — flag them for
a joint product conversation, don't guess at either from the backend side alone.

#### 7.6 — HR & Payroll ✅ built, backend side confirmed

[`modules/hr-payroll.md`](../frontend/modules/hr-payroll.md)

**Status:** `hr/` and `payroll/` built as two Nest modules (matching the module doc's own
two-folder split), five controller/service pairs by concern: `employees`/`employee-leave` in
`hr/`, `salary-structures`/`payroll-periods`/`payslips` in `payroll/` — `PayrollModule` imports
`HrModule` directly for the employee-existence/name/designation lookups a salary structure or
payslip needs, same `FeesModule`→`AdmissionsModule` cross-module pattern Phase 6/3 already set.
Migration `20260909175300_phase7_6_hr_payroll` applied, e2e-tested against a live Postgres/Redis
(`test/hr-payroll.e2e-spec.ts`: 30 tests — employee CRUD with the `employeeId`-uniqueness conflict,
the transfer/resignation/termination lifecycle with its terminal-state guard, employee leave
submit → approval-queue → approve with the `employeeId=me` idiom and its real `LeaveBalance.used`
increment, salary-structure upsert, the payroll period `draft → generated → approved` state
machine including a real PRD §20 absence-deduction input, the payslip publish gate
(`employeeId=me` only ever sees `approved` periods), and tenant/permission isolation). `npm run
verify` green; the full e2e suite is green except the one **pre-existing, unrelated**
`academics.e2e-spec.ts` date-bomb failure Phase 7.4's own status note already flagged (not touched
here).

**This phase's own resolved integration task — the teacher↔employee linkage:** the module doc
flagged `TeacherLeaveTab`'s `Employee.id === Teacher.id` assumption as unconfirmed. That equality
can't be made true in general (the two rows are independently created with independently
generated uuids), so the real link built here is `Employee.teacherId` — an explicit, optional,
`@unique` FK to `Teacher.id`, set at employee creation for staff who are also teachers. **This is a
genuine, flagged frontend follow-up, not fully closed by this phase alone:**
`frontend/src/features/teachers/components/TeacherProfile.tsx`'s `TeacherLeaveTab` still passes
`teacher.id` straight through as `employeeId`, which now resolves nothing — that call site needs a
small change (e.g. a `GET /hr/employees?teacherId=` lookup, not built this phase since nothing in
the assumed contract calls for it yet) to resolve the linked employee id instead. See
`Employee.teacherId`'s own schema doc comment for the fuller reasoning.

**A second data-modeling call worth flagging:** `Employee.employeeId` (the org's human-readable
staff code, e.g. "EMP-001") is a completely different thing from this row's own `id` primary key
and from `Employee.teacherId` above — same three-different-identifiers shape `Teacher.id`/
`Teacher.employeeId`/`Teacher.userId` already has. Every `employeeId` path/query param across this
contract (`/payroll/salary-structures/:employeeId`, `?employeeId=me`, etc.) means the row's real
`id`, never the human code — worth restating explicitly since the field name overlap invites
confusion.

- **Modules:** `hr/` (`employees`, `employee-leave`), `payroll/` (`salary-structures`,
  `payroll-periods`, `payslips`).
- **Entities:** `Employee` (`teacherId`/`userId` both nullable `@unique`, see above),
  `EmployeeLifecycleEvent` (transfer/resignation/termination, append-only), `EmployeeLeaveRequest`
  (own model/table, never sharing rows with student `LeaveRequest`), `LeaveBalance` (one row per
  `(employee, leaveType)`, seeded with fixed default allotments at employee creation),
  `SalaryStructure` (one row per employee), `PayrollPeriod` (`draft → generated → approved`),
  `Payslip` (one row per `(period, employee)`, never edited after generation — a correction re-runs
  a new period).
- **Endpoints (as actually built):**
  ```
  GET/POST/PATCH /hr/employees          hr.read / hr.manage; no DELETE — status changes only via
                                         the three lifecycle actions below
  POST /hr/transfers                    hr.manage; requires newDepartment/newDesignation
  POST /hr/resignations                 hr.manage; 409s once resigned/terminated (terminal state)
  POST /hr/terminations                 hr.manage; same terminal-state guard
  GET/POST /leave/employee              no route-level gate (self-service); employeeId=me idiom;
                                         POST always resolves to the caller's own linked Employee
  PATCH /leave/employee/:id             leave.approve; 409s an already-reviewed request; approving
                                         increments the matching LeaveBalance.used
  GET  /leave/employee/balances         employeeId=me idiom; always returns all four leave types
  GET/PUT /payroll/salary-structures/:employeeId   payroll.read (GET) / payroll.run (PUT); GET
                                         returns an empty 200 body (not literal JSON null) when
                                         unset — see the controller's own doc comment
  GET/POST /payroll/periods             payroll.read (GET) / payroll.run (POST)
  POST /payroll/periods/:id/run         payroll.run; draft → generated; 409s outside draft
  POST /payroll/periods/:id/approve     payroll.approve; generated → approved; 409s outside generated
  GET  /payroll/payslips                no route-level gate; filterable by periodId or
                                         employeeId=me; an employeeId filter always restricts to
                                         approved periods (the publish gate), a bare periodId shows
                                         every status
  GET  /payroll/payslips/:id            no route-level gate
  ```
- **Payroll math (PRD §20's formula) is computed entirely server-side** (`payroll-calc.ts`) — the
  frontend only displays the breakdown, per its own resolved assumption. **A real, flagged limit,
  not a bug:** `overtime`/`bonus` are always `0` — nothing in this contract's built scope captures a
  per-period overtime-hours or bonus-amount input yet (`SalaryStructureForm`'s fixed inputs don't
  extend that far, module doc "Simplifications made to fit this doc's own scope"). `absenceDeduction`
  **is** real, computed at `run` time from approved `unpaid` `EmployeeLeaveRequest` days overlapping
  the period, at a flat `basicSalary / 30` daily rate — the one place this phase went beyond the
  fixed-input-only math the module doc originally scoped, since the PRD's own formula names
  "Absence" as a real line item and the data to compute it honestly (approved unpaid leave) already
  exists from the HR half of this same phase.

**Not built this phase, per the module doc's own explicitly deferred scope:** recruitment/ATS;
contracts/document upload (waits on `documents-certificates.md`'s real upload endpoint); a holiday
calendar reference on the leave summary. Leave types stay a fixed four-value enum and department/
designation stay free text, matching the module doc's own simplification call.

**Integration task:** run `frontend`'s existing hr/payroll component/hook tests against this real
backend locally, and land the `TeacherProfile.tsx` follow-up above — every other contract question
this phase had (the `employeeId=me` idiom, the payroll period state machine, the null-body nuance
on an unset salary structure) is resolved above, so what's left is verification plus that one
frontend change, not further backend design.

#### 7.7 — Communication

[`modules/communication.md`](../frontend/modules/communication.md)

- **Modules:** `communication/` — five controller/service pairs by sub-area (notifications,
  messages, announcements, events, ptm) plus `communication/realtime/` (the `/ws` gateway). §36's
  actual push/email/SMS/WhatsApp delivery engine is **not** built here, per the module doc's own
  "never the delivery infrastructure" note — left as a background-worker follow-up.
- **Entities:** `Notification`, `NotificationPreference` (one row per `(user, type)`, unset types
  default to `[inApp]` at read time), `MessageThread`/`MessageParticipant`/`Message` (real
  per-user membership + read-state, not just a `participantLabels` string array), `Announcement`,
  `Event` (manually-created rows only — `holiday`/`exam` `isExternal` entries are synthesized at
  read time from `Holiday`/`Exam`, never written here), `PtmSlot` (a slot and its booking are the
  same row, per the module doc).
- **Endpoints (as actually built):**
  ```
  GET  /notifications                   self-service, no gate; filterable by type/unreadOnly
  GET  /notifications/unread-count      self-service, no gate
  GET/PUT /notifications/preferences    self-service, no gate; PUT is a full replace, not a
                                         per-type patch (NotificationPreference's compound unique
                                         key includes tenantId, same upsert friction LeaveBalance's
                                         own key has — sidestepped with delete-then-recreate)
  PATCH /notifications/:id/read         self-service, no gate
  PATCH /notifications/read-all         self-service, no gate
  GET/POST /messages/threads            self-service (no gate) / messages.send
  GET  /messages/threads/:id            self-service; 404s a non-participant
  POST /messages/threads/:id/messages   self-service, no gate — any participant can reply
  PATCH /messages/threads/:id/read      self-service, no gate
  GET/POST/PATCH/DELETE /announcements  announcements.read (GET) / announcements.create (write) —
                                         router.tsx's own comment: "announcements carries the
                                         module doc's explicit announcements.read string"
  GET  /events                          no gate — "common information everyone reads"; merges this
                                         module's own rows with isExternal Holiday/Exam mirrors
  POST/PATCH/DELETE /events             events.manage; a synthetic isExternal id (e.g.
                                         `holiday-<id>`) simply 404s on PATCH/DELETE — never a real
                                         Event row, no special-casing needed
  GET  /ptm/availability                no gate — read by both the teacher-manage and parent-book
                                         flows; teacherId accepts a real Teacher.id or 'me'
  POST/DELETE /ptm/slots(/:id)          ptm.manage; always the caller's own teacherId=me record
  POST /ptm/book                        ptm.book; studentId supports 'me' (Student booking self) or
                                         a Parent's linked child (ParentStudentLink-checked)
  GET  /ptm/bookings/mine               self-service, no gate; scoped to bookedByUserId === caller
  POST /ptm/bookings/:id/cancel         self-service, no gate; caller must be the booker or the
                                         slot's own teacher
  PATCH /ptm/bookings/:id               ptm.manage; caller must be the slot's own teacher
  ```
- **The `/ws` Socket.IO gateway is built this phase**, per this section's original call — a
  `CommunicationGateway` (namespace `/ws`) authenticated off the same access token as the HTTP
  side (verified from the handshake's `auth.token`/`?token=`, not a header — WS handshakes carry
  neither the `Authorization` header nor the httpOnly refresh cookie), joining every socket to its
  own `user:<userId>` room. `RealtimeService` is the one thing `NotificationsService`/
  `MessagesService`/`PtmService` call to push a live event (`notification:new`, `message:new`) —
  fire-and-forget, REST stays the source of truth, a missed emit is never a correctness bug. The
  frontend's own polling (unread count every 30s) still works unchanged; wiring an actual `/ws`
  client there is the follow-up the module doc's own checklist already flagged as open.
- **A real, flagged gap, not a bug:** `PtmSlotManager.tsx` (the teacher's own slot-management view)
  reads `GET /ptm/availability?teacherId=` with `session.user.id` (a `User.id`) rather than the
  real `Teacher.id` or the `'me'` idiom every other `teacherId`/`studentId`/`employeeId` query
  param in this API supports — `PtmBookingFlow.tsx`'s own `teacherId` (from `useTeachersQuery`) is
  the real id, so this is a one-component frontend bug, not a contract mismatch; fix is to pass
  `'me'` instead, same as this doc's own Phase 7.6 `TeacherProfile.tsx` follow-up.
- **Integration task:** the two component-level interactive tests the frontend's own checklist
  still had open (send/receive a thread end to end, book a PTM slot end to end) are now covered by
  `test/communication.e2e-spec.ts` against this real backend — run `frontend`'s existing
  communication component/hook tests against it too, and land the `PtmSlotManager.tsx`
  `teacherId=me` fix above.

#### 7.8 — Reports & Analytics ✅ built, backend side confirmed

[`modules/reports-analytics.md`](../frontend/modules/reports-analytics.md)

**Status:** every endpoint `api.ts` assumes is built (`src/reports/`, one controller/service pair —
this module never grew the five-file-per-concern shape earlier phases needed, since it's read/
aggregation only, nothing to CRUD). **No Prisma migration this phase** — a real, deliberate first
for this plan's phase table: `reports/` persists nothing of its own, it only reads
`AttendanceRecord`/`ExamMark`/`Invoice`/`Payment`/`Payslip`/`AdmissionApplication`/`Student`/
`Teacher` rows every earlier phase's migration already created. `test/reports.e2e-spec.ts` (14
tests) green against live Postgres/Redis; `npm run verify`'s typecheck/lint/format/secretlint/unit
legs all green (see "Not run clean" below for the one pre-existing exception, unrelated to this
phase). Unlike every earlier phase's own e2e spec, this one seeds its `AttendanceRecord`/`Exam`/
`ExamMark`/`Invoice`/`Payment`/`PayrollPeriod`/`Payslip`/`AdmissionApplication` fixtures directly
via Prisma rather than replaying each owning module's own API — those write flows are already
covered by their own specs; this one verifies the aggregation math, the `reports.read`/
`reports.export` gates, tenant isolation, and the export endpoint's actual binary responses
(real `%PDF-` bytes, a real `PK`-signed xlsx zip, CSV text containing the real computed numbers).

- **Module:** `reports/` — one `ReportsController`/`ReportsService` pair, `ReportsModule` imports
  `FeesModule` directly for `InvoicesService.getOutstanding` (same cross-module-reuse pattern
  `AdmissionsModule`→`FeesModule` and `PayrollModule`→`HrModule` already established) rather than
  re-deriving outstanding-balance math a third way.
- **Entities:** none new — see "No Prisma migration" above.
- **Endpoints (as actually built):**
  ```
  GET /reports/principal-dashboard         reports.read
  GET /reports/academic?classId=&subjectId= reports.read
  GET /reports/financial?from=&to=          reports.read
  GET /reports/:id/export?format=pdf|excel|csv  reports.export; :id one of the three routes above
  ```
- **PDF/Excel export is real, generated server-side, not a thin pass-through** — `pdf-lib`
  (already a dependency, `certificates/pdf/certificate-pdf.ts`'s own library) renders a paginating
  letterhead-style PDF (`src/reports/pdf/report-pdf.ts` — the first PDF in this codebase that
  actually spans more than one page); a new dependency, `exceljs` (added this phase — see
  "Dependency added" below), renders a real multi-sheet `.xlsx` workbook
  (`src/reports/excel/report-excel.ts`); CSV is a flat text render
  (`src/reports/export/report-csv.ts`). All three consume one shared intermediate shape
  (`src/reports/export/report-export-model.ts`'s `ReportExportModel` — pure, unit-testable
  build\* functions, same "business logic that happens to render, not fetch" split
  `examinations/grading-scale.ts` already uses) instead of three renderers each re-deriving their
  own layout from the raw report DTOs.

**Real design decisions this phase had to make that the module doc leaves as open questions,
flagged rather than guessed silently — the full reasoning lives in `ReportsService`'s own header
comment, summarized here:**

- **"Current term" scoping, with a documented fallback.** The principal dashboard's attendance/
  fees-collected/admissions/academic-performance figures are scoped to "the term running right
  now" (`Term.startDate <= today <= endDate`), falling back to a trailing 90-day window when no
  term is configured — the exact fallback `attendance.service.ts`'s own `'term'` analytics scope
  already uses, duplicated here rather than shared (same small-per-module-helper convention
  `csvEscape` already repeats twice). `outstandingFees` is the one dashboard figure deliberately
  **not** term-scoped — "outstanding" is inherently a right-now snapshot, matching the Fees
  module's own outstanding-balances view (no date filter there either), and is literally
  `InvoicesService.getOutstanding()`'s own number, not a second copy of it.
- **No `Expense`/accounting entity exists** (`Invoice`'s own schema.prisma header comment: "§19
  accounting ... not built here" — confirmed still true this phase). `totalExpenses` (financial
  report) is `Payslip.netPay` summed over **approved** payroll periods overlapping the requested
  range — the only real "money out" this schema tracks; a draft/generated-but-unapproved period's
  payslips are excluded (not yet a committed expense).
- **`collectionRatePct`/`outstandingTotal` are billing-anchored (`Invoice.dueDate` in range),
  `totalRevenue` is cash-anchored (`Payment.paidAt` in range)** — two different questions a
  financial report legitimately asks ("of what was billed this period, how much is collected/
  owed" vs. "how much cash actually moved"). A payment landing just outside the window against an
  invoice due inside it (or the reverse) is real, intentional skew between the two, not a bug.
- **Academic report only reads `Exam.isPublished` marks** — same visibility rule
  `report-cards.controller.ts`'s own student/parent gate already enforces; an entered-but-
  unpublished mark moves nothing here.
- **`teacherPerformance` attribution goes through `TeacherAssignment`** (subject+class+section) —
  a mark whose exam's (subjectId, classId, sectionId) has no matching assignment row contributes
  to every other table but is silently excluded from this one (no invented "Unassigned" row).
- **`academicPerformancePct` (dashboard headline) is a mean score percentage, not a pass rate** —
  `overallPassRatePct` (academic report) already owns the pass-rate framing.
- **CSV/Excel formula-injection guard added** (OWASP "CSV Injection", not called out by the module
  doc): `className`/`subjectName`/`teacherName` in the exported tables are free text entered
  through other modules' own CRUD forms, so a value starting with `=`/`+`/`-`/`@` gets a leading
  `'` prefix (`report-export-model.ts`'s `sanitizeSpreadsheetCell`, applied by the CSV/Excel
  renderers only — `report-pdf.ts` draws plain text, nothing to neutralize there) before it can
  execute as a formula the moment a principal opens the file in Excel/Sheets. Caught during this
  phase's own `security-standards` pass, not present anywhere else in this codebase's two other
  CSV exporters (`students.service.ts`, `attendance.service.ts`) either — worth backporting there
  if this is ever revisited.

**Dependency added:** `exceljs@^4.4.0` (real `.xlsx` generation — nothing already in
`package.json` produces a spreadsheet file). `npm audit` shows it pulls one moderate CVE
(`uuid < 11.1.1`'s missing buffer-bounds-check advisory) via its own transitive `uuid` — verified
low real risk here: exceljs only uses `uuid` for internal calc-chain ids, this codebase never
passes a caller-supplied buffer through it. Confirmed via `git stash` that the pipeline's
pre-existing 9 high-severity findings (the `multer`/`@nestjs/*` chain, `npm audit fix --force`
territory) predate this phase entirely — `exceljs` added zero high-severity findings, one
moderate.

**Not run clean, but not this phase's fault:** `npm run audit` (part of `verify`) fails on the
pre-existing `multer`/`@nestjs/*` high-severity chain above — true before this phase too (see
"Dependency added"), not fixed here (each fix is its own breaking major-version bump, out of this
phase's scope). Separately, `test/academics.e2e-spec.ts`'s `'analytics groups by class'` test
now fails on a clean run: it seeds attendance on a hardcoded date (`'2026-09-07'`) and then queries
`scope: 'daily'` (today) — true on the date that Phase 4 shipped, false now that wall-clock "today"
has drifted past it. Not touched by this phase (this module's own `test/reports.e2e-spec.ts` uses
`new Date()`-relative fixture dates for exactly this reason), flagged here since it surfaced while
running the full suite for this phase's own exit check.

- **Integration task:** run `frontend`'s existing reports component/hook tests against this real
  backend (not just their own mocked `PrincipalDashboard.test.tsx`) — every contract question this
  phase had is resolved above, so what's left is verification, not design.

#### 7.9 — Platform Console (Super Admin)

[`modules/platform-console.md`](../frontend/modules/platform-console.md)

- **Module:** `platform/` — the one module that legitimately reads across tenants; every query here
  bypasses the normal single-tenant scoping (still permission-gated, but on `platform.*`
  permissions tied to the Super Admin role specifically, PRD §4's one role not scoped to a school).
- **Entities:** `School` (tenant summary view), `Plan`, `Subscription`, `BillingRecord`,
  `FeatureFlag`, `PlatformAuditLog`. Needs a real billing provider integration (Stripe or
  equivalent) for PRD §53's monthly/annual/trial/coupon/invoice/usage-limit requirements — this
  phase's biggest scope item isn't the CRUD, it's the billing integration underneath it.
- **Endpoints:**
  ```
  GET/POST/PATCH /platform/schools
  GET/POST/PATCH /platform/subscriptions
  GET/POST/PATCH /platform/plans
  GET  /platform/billing
  GET  /platform/users
  GET  /platform/usage
  GET/PATCH /platform/feature-flags
  GET  /platform/system-health
  GET  /platform/audit-logs
  ```
- **Integration task:** confirm with product/security whether "log in as this school" support
  tooling is in scope at all — the frontend explicitly did not build it, treating it as its own
  audited feature rather than a casual admin convenience; don't add a backend endpoint for it
  without that same review.

**Status: ✅ built + e2e-tested against live Postgres/Redis/MinIO (21 new tests,
`test/platform.e2e-spec.ts`) — all 20 documented endpoints implemented, wired into `PlatformModule`
and confirmed live against a running server, not just unit-tested.**

**Two real design decisions this phase had to make that neither module doc nor the schema fully
settled, both flagged rather than guessed silently:**

- **A Super Admin has to belong to _some_ tenant.** `User.tenantId` has been a required column
  since Phase 0, and PRD §4 calls Super Admin "the one role not scoped to a school" — those two
  facts are in tension, and this is the first phase to actually mint a Super Admin session (nothing
  before this consumed `platform.*` permissions). Considered making `tenantId` nullable across
  every already-shipped auth code path (`JwtStrategy.validate`'s `!payload.tenantId` check,
  `AuthService`, `RequestContextService`, `tenant-scoping.ts`) instead — rejected as a large,
  unnecessary blast radius touching six already-tested phases for a problem with a much smaller
  fix: `prisma/seed.ts` now seeds one housekeeping `Tenant` (`slug: 'platform-console'`,
  deliberately no `School` row) to hold the Super Admin account. `SchoolsService`/
  `PlatformUsersService` both filter on `school: { isNot: null }` specifically so this account
  never appears in a schools list or a support user search — see `prisma/seed.ts`'s own comment.
- **Onboarding a school creates its first admin as `status: INVITED` with an unusable password
  hash**, which surfaced a real, previously-unexercised gap: `AuthService.forgotPassword`'s own
  lookup (`findAuthCandidatesByIdentifier`) only ever resolves an already-`ACTIVE` account, so it
  can't be what gets a brand-new INVITED account its first token. Added
  `AuthService.issueInviteToken` (same dev-only "log it, don't email it" placeholder as
  `forgotPassword` — Phase 7.7's notification worker still isn't built) and extended
  `AuthService.resetPassword`/`UsersService.setPasswordAndActivate` (renamed from
  `updatePasswordHash`) to flip `status` to `ACTIVE` on redemption, not just set the password —
  a no-op for the existing forgot-password flow (already-`ACTIVE` accounts), and the only thing
  that makes `POST /platform/schools` not a dead end. Verified end-to-end in
  `platform.e2e-spec.ts`: onboard → capture the logged invite token → redeem it → log in as the
  new owner.

**Billing integration** (this phase's stated "biggest scope item"): `platform/billing-provider.ts`
defines a `BillingProvider` interface with two implementations, chosen by a factory provider in
`PlatformModule` based on whether `STRIPE_SECRET_KEY` is configured —

- `StripeBillingProvider`: a real integration against the `stripe` SDK (customer + subscription
  creation with a 14-day trial, plan changes with proration, cancel-at-period-end) plus
  `platform/billing-webhook.controller.ts`'s `POST /platform/billing/webhook` (public,
  signature-verified via `stripe.webhooks.constructEvent`, `main.ts`'s new `rawBody: true`) syncing
  `invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted` onto
  `BillingRecord`/`Subscription`. **Not exercised against live Stripe in this environment** (no
  test-mode API key available here) — reviewed against the `stripe` Node SDK v22 API shape
  (`current_period_start`/`end` moved onto `SubscriptionItem`, not `Subscription`, in this API
  version; verified against the installed package's own `.d.ts` files), not verified end-to-end.
  Verify with a real Stripe test-mode key before relying on this in staging.
- `LocalBillingProvider`: a real (not faked) dev/CI stand-in — deterministic trial dates, no
  network call, same discipline `AuthService.forgotPassword`'s dev-only reset-link logging already
  established. This is what every test in this environment actually runs against.

Every plan/subscription-provisioning call site also writes one `BillingRecord` directly
(`BillingService.recordFirstPeriod`) right after provisioning — `LocalBillingProvider` never fires
a webhook (there's no invoicing engine behind it), so without this `BillingTable` would be empty
forever under local mode; a real Stripe subscription gets this first record the same way _and_
every later one from the webhook.

**Schema additions:** `Plan`, `Subscription`, `BillingRecord`, `FeatureFlag`, `PlatformAuditLog` —
none of them in `TENANT_SCOPED_MODELS` (`common/prisma/tenant-scoped-models.ts`'s own doc comment
already explains why: this module's whole job is reading across every tenant, which
`applyTenantScoping` would otherwise refuse). All five accessed exclusively through
`PlatformPrismaService`, the module's third and fourth sanctioned call sites alongside the two
`platform-prisma.service.ts`'s own doc comment already listed (auth's pre-tenant-context lookups,
`GET /certificates/verify/:code`). `Subscription.stripeSubscriptionId` and
`BillingRecord.providerInvoiceId` are both `@unique` (nullable — Postgres allows multiple `NULL`s
under a unique index) so the webhook handler can `findUnique`/`upsert` by Stripe's own id instead
of a `findFirst` scan. `FeatureFlag.@@unique([key, tenantId])` does **not** actually stop two
`PLATFORM`-scope rows (`tenantId: null`) for the same `key` at the DB level — Postgres treats every
`NULL` as distinct — flagged in the schema's own comment; `prisma/seed.ts`'s `findFirst`-then-
create-or-update (not `upsert` on that compound key, which Prisma's generated type refuses to
accept a `null` half of) is what keeps the seeded catalog to one row per key in practice.

**Feature flags ship as admin-console CRUD only this phase** — `GET/PATCH /platform/feature-flags`
list/toggle a fixed, seeded catalog (self-service flag creation isn't built, matching
`platform-console.md`'s own "Open questions" note). No feature-owning module actually _reads_ this
table yet to gate its own behavior: `hostel.md`'s own deferred "not every tenant is a boarding
school" question (this doc's Phase 7.5 notes) is the seeded `hostel_module` catalog entry, but
wiring a real consumer — and the "a `TENANT`-scope row wins over the `PLATFORM` one for that
tenant" resolution logic that implies — is that consumer's own future work, not guessed at here.

**Usage dashboard is a mix of real aggregates and honestly-flagged placeholders**
(`usage.service.ts`'s own doc comment has the full breakdown) — `activeSchools`/`activeUsers`/
`activeStudents`/`mrr`/`storageUsedGb` (real, the last one summing every `DocumentVersion.
sizeBytes` this app has ever stored) and a simplified `churnRatePct` proxy are real; `apiCallsToday`/
`errorRate24hPct`/`backgroundJobsPending`/`aiTokensToday` are `0` — there is no request-rate
counter, error-rate tracker, or background job queue anywhere in this codebase yet (`ai/` itself is
Phase 7.10, explicitly last). **System health's `services[]` are real timed pings** against this
app's own Postgres/Redis/storage (the same three `/health` already checks, reused here for latency
`GET /health`'s boolean up/down doesn't give); **`jobQueues` is always `[]`** — an honest empty
list, not a fabricated queue.

**Dependency added:** `stripe@^22.6.2`. `npm audit` shows it contributes zero entries to the
vulnerability list — every package that does show up (`@nestjs/*`, `multer`, `prisma`,
`exceljs`/`uuid`) predates this phase, matching Phase 7.8's own note on the same pre-existing
`multer`/`@nestjs/*` chain.

- **Integration task:** run `frontend`'s existing platform component/hook tests against this real
  backend (not just their own mocked `SchoolsPage.test.tsx`/`FeatureFlagsPage.test.tsx`) — every
  contract question this phase had is resolved above, so what's left is verification, not design.
  Separately, decide on a real Stripe test-mode key for staging before this billing integration is
  anything more than `LocalBillingProvider` in practice.

#### 7.10 — AI Assistant (explicitly last, on both sides)

**Status: 🔮 future plan — not started, not scheduled.** Every phase through 7.9 is done; this is
the only remaining item in this plan, deliberately deferred (PRD §34/§35's own explicit "last"
framing, restated in this section's own heading). Nothing below has been built — kept here as the
plan for when this phase actually starts, not as in-progress work.

[`modules/ai-assistant.md`](../frontend/modules/ai-assistant.md)

- **This phase does not start with a REST endpoint list — it starts with the permission-scoped
  tool-calling/agent layer itself**, reviewed against the `security-standards` skill specifically
  for AI data access (PRD §34's hard requirement: the assistant must never see data the asking user
  couldn't otherwise see). Build and document that layer first; only then implement:
  ```
  POST /ai/query                  School Assistant NL Q&A — response must include what data it
                                  looked at (explainability), scoped to the caller's own permissions
  POST /ai/generate                Teacher Assistant content generation (draft only, never
                                  auto-published into homework/exams)
  GET  /ai/analytics/:studentId    advisory insights, not a new source of truth
  POST /ai/documents/process       OCR → vision model → LLM extraction → schema validation →
                                  human review (§35) — surfaces as status on the existing
                                  documents/ upload primitive, not a new upload flow
  ```
- Do not let frontend start UI work on this module until the tool-calling layer's contract is
  documented — building ahead of it risks designing around assumptions that don't match the
  eventual security model, per the frontend module doc's own explicit warning.

## Infrastructure & environments

Per PRD §48:

- **Local dev:** `docker-compose.yml` (postgres, redis, minio) + `npm run dev` — no cloud
  dependency to develop against.
- **Staging/production (AWS, per PRD §48's example):** ECS/Fargate for the API, RDS PostgreSQL,
  ElastiCache Redis, S3, SQS or BullMQ-on-ElastiCache for queues, SES for email, CloudFront in
  front of the frontend build, Secrets Manager for credentials, WAF, Route 53, CloudWatch for logs/
  metrics. Vercel remains an option for the frontend build specifically (per PRD §48's note) with
  this backend hosted separately — no change needed here either way.
- **CI/CD:** GitHub Actions — lint/test/build on every PR, migration-dry-run against a throwaway
  Postgres, deploy-on-merge-to-main to staging, manual promote to production.

## Testing strategy (PRD §62, backend scope)

- **Unit:** services, business logic (permission checks, payroll formula, grading calculations,
  depreciation if it ever moves server-side, occupancy math) — pure functions get pure unit tests,
  same discipline the frontend already applies to its own `lib/*.ts` files.
- **Integration:** every module's controller+service+Prisma path, run against a real (dockerized)
  Postgres + Redis, not mocks — this is where tenant isolation and permission gating actually get
  proven, not in unit tests with a stubbed Prisma client.
- **E2E (supertest, per module):** log in as a seeded user of each relevant role, exercise the
  module's real HTTP surface end to end (create → read → update → the module's own workflow, e.g.
  admission stage transitions or payroll's draft→generated→approved gate), assert both the response
  shape _and_ that a wrong-tenant/wrong-permission request is rejected.
- **Cross-stack E2E (the phase-closing step every phase above calls for):** once a phase's backend
  endpoints are live, run the _frontend's own_ existing test suite and, where it has one, its
  Playwright/browser flow against this real backend instead of its mocks — this is what actually
  turns "pending backend contract" into "confirmed" in the frontend plan, not a backend-only test
  passing in isolation.
- **Critical end-to-end workflows** (PRD §63) get one full-stack test each once their owning phases
  are all done: new student (admission→enrollment), daily attendance, fee payment, examination,
  transport pickup — run against both apps together, not simulated.

## Cross-cutting Definition of Done — every module, every phase

Not repeated per module above — treat this as the backend-side counterpart to the frontend plan's
own cross-cutting checklist (`frontend/implementation-plan.md`):

- [ ] Prisma schema migration committed, reviewed for tenant-scoping (`tenantId`/`branchId` present
      on every tenant-owned table) and indexing (foreign keys, common filter columns)
- [ ] Every mutating endpoint gated by `@RequirePermission` using the exact string the frontend
      already calls `can()`/`RequirePermission` with (cross-check against the catalog above)
- [ ] DTO validation matches the frontend's `schemas.ts` field-for-field (same required/optional,
      same string/number/enum constraints) — drift here is the single most common source of a
      "works in Postman, breaks in the app" bug
- [ ] Audit logging wired for every create/update/delete (PRD §43)
- [ ] Unit tests for business logic, integration tests for the controller+service+DB path, an e2e
      spec exercising the module's real workflow as at least one seeded role
- [ ] Swagger annotations complete (`@ApiProperty` etc.) — this doc becomes the generated-client
      source later, incomplete annotations now are a future migration cost
- [ ] Checked against the `security-standards` skill — mandatory for anything touching auth, file
      upload, payments, or PII (students/health/payroll all qualify)
- [ ] The corresponding `frontend/modules/<name>.md` doc's "pending backend contract" line is
      updated to reflect what was actually confirmed or changed this phase — this plan and the
      frontend plan should never silently drift back out of sync once a phase closes

## Integration tracker

The actual side-by-side status, phase by phase. Update this table as each phase's integration pass
completes — it's the single place that answers "is this module really done, or just done on one
side?"

| Phase | Module(s)                                                                  | Frontend                                                                         | Backend                                                                                                                                                                                                                    | Integration                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Foundation                                                                 | ✅ done                                                                          | ✅ scaffolded (unverified against a live DB in this environment — see Phase 0's own status note)                                                                                                                           | — (no frontend-facing surface)                                                                                                                                                                             |
| 1     | Auth & Identity                                                            | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis                                                                                                                                                                          | ✅ confirmed backend-side (see Phase 1 notes above); frontend bootstrap-retry-storm bug found, not yet fixed                                                                                               |
| 2     | School Setup & Core Entities                                               | ✅ done, assumed contract                                                        | ✅ built + unit-tested; e2e spec written, unverified against live Postgres/Redis in this env                                                                                                                               | ⏳ nested-resource shape confirmed (see Phase 2 notes); cross-stack verification still pending live DB                                                                                                     |
| 3     | People (Students/Parents/Teachers/Admissions) + Documents upload primitive | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis/MinIO (32 new tests; also confirmed Phase 0–2's e2e specs for the first time)                                                                                            | ⏳ two real gaps flagged (enroll's missing gender/section data, Parent.userId provisioning) — otherwise cross-stack verification pending                                                                   |
| 4     | Academics (Timetable/Attendance/Homework)                                  | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis (38 tests)                                                                                                                                                               | ⏳ `'me'` idiom + permission catalog confirmed backend-side; `groupBy=branch` schema gap flagged; cross-stack verification pending                                                                         |
| 5     | Examinations                                                               | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis (23 tests)                                                                                                                                                               | ⏳ grading scale, report-card series grouping, marks lock/reopen confirmed backend-side; cross-stack verification + print-preview pending                                                                  |
| 6     | Finance (Fees, Search)                                                     | ✅ done, assumed contract — **closes frontend's PRD §65 MVP**                    | ✅ built + e2e-tested against live Postgres/Redis (33 tests) + confirmed the admissions↔fees integration end-to-end                                                                                                        | ⏳ backend confirmed (see Phase 6 notes above) — **PRD §65 MVP genuinely end-to-end once frontend's Phase 6 screens are re-verified against these real endpoints**; cross-stack verification still pending |
| 7.1   | Documents & Certificates                                                   | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis/MinIO (10 new tests; also fixed a MinIO-reachability infra bug that had been silently affecting every earlier phase — see Phase 7.1 notes)                               | ⏳ backend confirmed (see Phase 7.1 notes above); cross-stack verification still pending                                                                                                                   |
| 7.2   | Library                                                                    | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis (22 new tests; see Phase 7.2 notes)                                                                                                                                      | ⏳ backend confirmed (see Phase 7.2 notes above); cross-stack verification still pending                                                                                                                   |
| 7.3   | Transport (vehicle/route)                                                  | ✅ done, assumed contract (live tracking not built either side)                  | ✅ built + e2e-tested against live Postgres/Redis (22 new tests; see Phase 7.3 notes)                                                                                                                                      | ⏳ backend confirmed (see Phase 7.3 notes above); cross-stack verification still pending                                                                                                                   |
| 7.4   | Inventory & Assets                                                         | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis (26 new tests; see Phase 7.4 notes — caught and fixed an `AssetStatus` enum-vs-hyphen bug before it shipped)                                                             | ⏳ backend confirmed (see Phase 7.4 notes above); cross-stack verification still pending                                                                                                                   |
| 7.5   | Hostel                                                                     | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis (42 new tests; see Phase 7.5 notes)                                                                                                                                      | ⏳ backend confirmed (see Phase 7.5 notes above); fee-linkage and feature-flag-gating decisions still open; cross-stack verification pending                                                               |
| 7.6   | HR & Payroll                                                               | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis (30 new tests; see Phase 7.6 notes — resolved the teacher↔employee linkage as a real `Employee.teacherId` FK)                                                            | ⏳ backend confirmed (see Phase 7.6 notes above); `TeacherProfile.tsx`'s `TeacherLeaveTab` needs a small follow-up to use the real linkage; cross-stack verification pending                               |
| 7.7   | Communication                                                              | ✅ done, assumed contract (built against polling; `/ws` client not wired in yet) | ✅ built + e2e-tested against live Postgres/Redis (`test/communication.e2e-spec.ts`), including the `/ws` gateway — see Phase 7.7 notes above (this row was stale until this status pass; the module was already complete) | ⏳ backend confirmed (see Phase 7.7 notes above); `PtmSlotManager.tsx`'s `teacherId=me` fix and wiring a real `/ws` client (frontend still polls) still open; cross-stack verification pending             |
| 7.8   | Reports & Analytics                                                        | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis (14 new tests; see Phase 7.8 notes — no new migration, added `exceljs` for real `.xlsx` export, added a CSV/Excel formula-injection guard)                               | ⏳ backend confirmed (see Phase 7.8 notes above); cross-stack verification still pending                                                                                                                   |
| 7.9   | Platform Console                                                           | ✅ done, assumed contract                                                        | ✅ built + e2e-tested against live Postgres/Redis/MinIO (21 new tests; see Phase 7.9 notes — Stripe billing integration real but unverified against live Stripe, `LocalBillingProvider` dev stand-in exercised instead)    | ⏳ backend confirmed (see Phase 7.9 notes above); cross-stack verification still pending; a real Stripe test-mode key needed before billing is anything more than local mode                               |
| 7.10  | AI Assistant                                                               | ⏳ not started (correctly — blocked on backend's tool-calling layer)             | ⏳ not started                                                                                                                                                                                                             | ⏳ backend's tool-calling layer must land before either side does feature work                                                                                                                             |

**Reading this table:** the frontend column is almost entirely "done" already — that's the starting
condition this whole plan was written for, not a milestone to celebrate mid-project. The real work
left in the product is the backend column and, phase by phase, turning each "blocked on backend"
integration cell into "confirmed." Sequence backend phases 0→6 first (closes the MVP), then 7.1
before the rest of 7.x (it unblocks Phase 3's upload primitive retroactively), then the remaining
7.x modules in the order listed, then 7.10 last.
