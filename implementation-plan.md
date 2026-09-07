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
platform.feature-flags.manage / platform.support.read / platform.audit.read
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
     `Invoice.admissionApplicationId` (also nullable) — a DB `CHECK` constraint enforces exactly
     one of the two is set on any row, never both, never neither. Fee/outstanding-balance queries
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

### Phase 5 — Examinations

Pairs with **frontend Phase 5 (done)** —
[`frontend/modules/examinations.md`](../frontend/modules/examinations.md).

**Module:** `examinations/`.

**Entities:** `Exam`, `ExamSchedule`, `Mark`, `Result`, `Grade`, `ReportCard`.

**Endpoints:**

```
CRUD /exams                       + a studentId filter for the portal list (flagged open)
GET  /exams/:id/marks-entry-sheet  one row per enrolled student, for the bulk grid
POST /exams/:id/marks              bulk upsert
GET  /exams/:id/results            grade/GPA/rank — server-computed, never recomputed client-side
                                   (frontend's own resolved assumption — keep it that way)
POST /exams/:id/publish            gated server-side by results.publish too, not just frontend RBAC
GET  /report-cards/:studentId
```

**Integration task:** grade/GPA/ranking calculation is entirely a backend concern per the
frontend's already-resolved assumption — implement the actual grading-scale logic here (PRD §16),
confirm the `studentId` filter on `GET /exams`, and do the one piece of verification that can't be
automated: a real-browser print-preview check of `/report-cards/:studentId` against real data
(`modules/examinations.md`'s own still-open item).

---

### Phase 6 — Finance

Pairs with **frontend Phase 6 (done) — closes the PRD §65 MVP on the frontend side.**
[`frontend/modules/fees.md`](../frontend/modules/fees.md).

**Modules:** `fees/`, `accounting/` (minimal — chart of accounts/expenses, not the full PRD §19
scope yet), `search/`.

**Entities:** `FeeStructure`, `Invoice` (`studentId` nullable + a new `admissionApplicationId`
nullable, DB `CHECK` enforcing exactly one is set — see Phase 3's resolved admissions↔fees ordering
decision; this is the concrete schema change that decision commits Phase 6 to), `Payment`,
`Refund`, `Discount`/`Scholarship`.

**Endpoints:**

```
CRUD /fees/structures
POST /fees/invoices                 single student or bulk-by-class
POST /fees/invoices/:id/payments
POST /fees/payments/:id/refund
GET  /fees/payments/:id/receipt
GET  /fees/outstanding              must handle admission-linked invoices with studentId: null —
                                     group/display by the linked AdmissionApplication's applicant
                                     name instead of a student record that may not exist yet
GET  /search?q=&type=                cross-entity (students, invoices, staff, ...) — Postgres
                                     full-text (`tsvector` + GIN index) per PRD §42
```

**Integration task — this is the MVP milestone.** Once this phase's endpoints are live and
`frontend`'s Phase 6 screens are re-verified against them (fee structures → invoice → payment →
receipt → outstanding-balances dashboard, plus `CommandPalette`'s real `/search`), **PRD §65's MVP
is genuinely end-to-end**, not just frontend-complete-against-assumptions. Verify the full flow
together (admission → enrollment → attendance → homework → exam → fee payment), not each module in
isolation — the frontend plan calls this out explicitly.

---

### Phase 7+ — Backlog modules

The frontend already shipped **every one of these** (except AI Assistant) against assumed
contracts. Build the backend in the same order the frontend already established, so each
integration pass has a finished, waiting frontend rather than the reverse:

#### 7.1 — Documents & Certificates (do early — Phase 3 already needs the base upload endpoint)

[`modules/documents-certificates.md`](../frontend/modules/documents-certificates.md)

- **Module:** `documents/` (extend Phase 3's primitive with the browse/search library + version
  history), `certificates/`.
- **Entities:** `Document`, `DocumentVersion`, `CertificateTemplate`, `Certificate`.
- **Endpoints:**
  ```
  GET  /documents?category=&ownerId=
  GET  /documents/:id/versions
  POST /certificates/generate      template + dynamic fields → PDF, QR, unique cert number
  GET  /certificates/verify/:code  PUBLIC, unauthenticated — no session required, matches the
                                   frontend's own bare-axios (non-apiClient) call
  ```
- **Integration task:** decide whether certificate dynamic fields come from a
  `POST /certificates/generate`-adjacent template-config endpoint or stay a frontend-fixed set
  (`CERTIFICATE_TEMPLATE_FIELDS`) — currently assumed-fixed, flagged open by the module doc. Also
  resolve §26's audited-access-reason requirement for medical documents specifically (an
  access-reason prompt beyond normal RBAC) — not built on either side yet.

#### 7.2 — Library

[`modules/library.md`](../frontend/modules/library.md)

- **Module:** `library/`.
- **Entities:** `Book`, `BookCopy`, `LibraryCategory`, `LibraryShelf`, `LibraryMember`, `Loan`,
  `Fine`, `Reservation`, `LibrarySettings`.
- **Endpoints:**
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
  POST /library/reservations/:id/fulfill      atomic: issues a copy + marks fulfilled
  GET  /library/loans?studentId=              'me' idiom
  ```
- **Integration task:** add the real `readyAt`/`expiresAt` fields to `Reservation` the frontend
  flags as missing — its own hold-expiry countdown is currently a client-side-only approximation
  (`lib/reservationExpiry.ts`) specifically because this field doesn't exist yet; adding it lets
  that whole client workaround be deleted in favor of a pure function over a real timestamp, ideally
  alongside a server-side auto-cancel job for expired holds.

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

#### 7.4 — Inventory & Assets

[`modules/inventory.md`](../frontend/modules/inventory.md)

- **Module:** `inventory/`.
- **Entities:** `StockCategory`, `StockItem`, `StockMovement`, `Asset`, `AssetMaintenanceRecord`.
- **Endpoints:**
  ```
  CRUD /inventory/stock-categories
  CRUD /inventory/stock                 quantity is read-only here — see below
  POST /inventory/stock/:id/movements    the only way quantity changes (issue/restock/adjustment) —
                                        matches frontend's StockAdjustmentDialog-only mutation path
  CRUD /assets
  ```

#### 7.5 — Hostel

[`modules/hostel.md`](../frontend/modules/hostel.md)

- **Module:** `hostel/`.
- **Entities:** `Hostel`, `Room` (with `floorLabel` as a plain field — no separate Floor entity,
  matching the frontend's collapsed `hostel → room → bed` hierarchy), `Allocation`, `Visitor`,
  `Complaint`. **No `Bed` entity** — a room's `capacity` is its bed count; occupancy is derived from
  active allocations server-side (`GET /hostel/rooms/:id/occupancy`), matching
  `lib/occupancy.ts`'s frontend logic exactly so the two never disagree about which beds are free.
- **Endpoints:**
  ```
  CRUD /hostel/hostels
  CRUD /hostel/rooms
  GET  /hostel/rooms/available?hostelId=
  GET  /hostel/rooms/:id/occupancy
  GET  /hostel/allocations
  POST /hostel/allocate
  PATCH /hostel/allocations/:id/reassign
  POST /hostel/allocations/:id/vacate
  GET/POST /hostel/visitors
  POST /hostel/visitors/:id/check-out
  CRUD /hostel/complaints
  ```
- **Integration task:** decide hostel fee linkage with `fees/` (a fee type/structure reference vs.
  a separate billing flow) — unresolved on both sides, needs a joint decision before either side
  builds it. Also confirm with product whether hostel features should be gated behind a
  school-level feature flag (not every tenant is a boarding school) — if yes, that's a
  `platform/feature-flags` catalog entry, not a hostel-module change.

#### 7.6 — HR & Payroll

[`modules/hr-payroll.md`](../frontend/modules/hr-payroll.md)

- **Modules:** `hr/`, `payroll/`.
- **Entities:** `Employee`, `EmployeeLifecycleEvent` (transfer/resignation/termination),
  `LeaveBalance`, `LeaveRequest` (employee), `SalaryStructure`, `PayrollPeriod`, `Payslip`.
- **Endpoints:**
  ```
  GET/POST/PATCH /hr/employees          no DELETE — status changes via lifecycle actions only
  POST /hr/transfers
  POST /hr/resignations
  POST /hr/terminations
  GET/POST /leave/employee               employeeId accepts 'me'
  PATCH /leave/employee/:id
  GET  /leave/employee/balances
  GET/PUT /payroll/salary-structures/:employeeId
  GET/POST /payroll/periods
  POST /payroll/periods/:id/run          draft → generated
  POST /payroll/periods/:id/approve      generated → approved
  GET  /payroll/payslips                 filterable by periodId or employeeId=me
  GET  /payroll/payslips/:id
  ```
- **Payroll math (PRD §20's formula) is computed entirely server-side** — the frontend only
  displays the breakdown, per its own resolved assumption; implement the formula here, don't let it
  drift into the frontend as a "just for preview" shortcut the way library's fine-rate preview
  originally did.
- **Integration task:** define the real teacher↔employee linkage (frontend currently assumes
  `Employee.id === Teacher.id`, flagged explicitly as unconfirmed) — this blocks
  `TeacherLeaveTab`'s reuse of `EmployeeLeaveSummary` from being correct for any school where that
  assumption doesn't hold.

#### 7.7 — Communication

[`modules/communication.md`](../frontend/modules/communication.md)

- **Module:** `communication/` (notifications, messages, announcements, events, PTM),
  `notifications/` (delivery engine, PRD §36 — push/email/SMS/WhatsApp providers + templates +
  retry/fallback, a background-worker concern, not this module's REST surface).
- **Entities:** `Notification`, `NotificationPreference`, `MessageThread`, `Message`,
  `Announcement`, `Event` (with `isExternal` holiday/exam mirrors sourced from `school-setup`/
  `examinations`, not owned here), `PtmSlot`, `PtmBooking` (one entity — frontend already merged
  these).
- **Endpoints:**
  ```
  GET  /notifications
  GET  /notifications/unread-count
  PATCH /notifications/:id/read
  PATCH /notifications/read-all
  GET/PUT /notifications/preferences
  GET  /messages/threads
  GET  /messages/threads/:id
  POST /messages/threads
  POST /messages/threads/:id/messages
  PATCH /messages/threads/:id/read
  CRUD /announcements
  CRUD /events                            isExternal entries read-only from this module's own CRUD
  GET  /ptm/availability
  POST /ptm/slots
  DELETE /ptm/slots/:id
  POST /ptm/book
  GET  /ptm/bookings/mine
  POST /ptm/bookings/:id/cancel
  PATCH /ptm/bookings/:id
  ```
- **This is where the `/ws` Socket.IO gateway finally gets built** — every earlier phase deferred
  realtime delivery to "after REST flows are proven"; this module is the first one where realtime
  is the actual point (notification delivery, live unread counts). Build REST first anyway
  (frontend already polls every 30s and will keep working once the gateway lands), then add the
  gateway and swap polling for push on the frontend side as a follow-up, not a blocking dependency.
- **Integration task:** the two component-level interactive tests the frontend's own checklist
  still has open (send/receive a thread end to end, book a PTM slot end to end) are a good shape
  for the first real e2e tests run against this live backend, not just frontend-mocked ones.

#### 7.8 — Reports & Analytics

[`modules/reports-analytics.md`](../frontend/modules/reports-analytics.md)

- **Module:** `reports/` — mostly read/aggregation over data every other module already owns; build
  this _after_ the modules it aggregates (fees, attendance, exams, admissions), not before.
- **Endpoints:**
  ```
  GET /reports/principal-dashboard
  GET /reports/academic?classId=&subjectId=
  GET /reports/financial?from=&to=
  GET /reports/:id/export?format=pdf|excel|csv
  ```
- PDF/Excel export is entirely server-generated (the frontend only triggers a blob download) —
  budget real time for report-template/export-formatting work here, it's not a thin pass-through.

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

#### 7.10 — AI Assistant (explicitly last, on both sides)

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

| Phase | Module(s)                                                                  | Frontend                                                             | Backend                                                                                                                         | Integration                                                                                                                              |
| ----- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Foundation                                                                 | ✅ done                                                              | ✅ scaffolded (unverified against a live DB in this environment — see Phase 0's own status note)                                | — (no frontend-facing surface)                                                                                                           |
| 1     | Auth & Identity                                                            | ✅ done, assumed contract                                            | ✅ built + e2e-tested against live Postgres/Redis                                                                               | ✅ confirmed backend-side (see Phase 1 notes above); frontend bootstrap-retry-storm bug found, not yet fixed                             |
| 2     | School Setup & Core Entities                                               | ✅ done, assumed contract                                            | ✅ built + unit-tested; e2e spec written, unverified against live Postgres/Redis in this env                                    | ⏳ nested-resource shape confirmed (see Phase 2 notes); cross-stack verification still pending live DB                                   |
| 3     | People (Students/Parents/Teachers/Admissions) + Documents upload primitive | ✅ done, assumed contract                                            | ✅ built + e2e-tested against live Postgres/Redis/MinIO (32 new tests; also confirmed Phase 0–2's e2e specs for the first time) | ⏳ two real gaps flagged (enroll's missing gender/section data, Parent.userId provisioning) — otherwise cross-stack verification pending |
| 4     | Academics (Timetable/Attendance/Homework)                                  | ✅ done, assumed contract                                            | ✅ built + e2e-tested against live Postgres/Redis (38 tests)                                                                    | ⏳ `'me'` idiom + permission catalog confirmed backend-side; `groupBy=branch` schema gap flagged; cross-stack verification pending       |
| 5     | Examinations                                                               | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend                                                                                                                    |
| 6     | Finance (Fees, Search)                                                     | ✅ done, assumed contract — **closes frontend's PRD §65 MVP**        | ⏳ not started                                                                                                                  | ⏳ blocked on backend — **this is the real MVP integration milestone**                                                                   |
| 7.1   | Documents & Certificates                                                   | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend                                                                                                                    |
| 7.2   | Library                                                                    | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend                                                                                                                    |
| 7.3   | Transport (vehicle/route)                                                  | ✅ done, assumed contract (live tracking not built either side)      | ⏳ not started                                                                                                                  | ⏳ blocked on backend                                                                                                                    |
| 7.4   | Inventory & Assets                                                         | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend                                                                                                                    |
| 7.5   | Hostel                                                                     | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend; fee-linkage decision needed first                                                                                 |
| 7.6   | HR & Payroll                                                               | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend; teacher↔employee linkage decision needed first                                                                    |
| 7.7   | Communication                                                              | ✅ done, assumed contract (realtime gateway not built either side)   | ⏳ not started                                                                                                                  | ⏳ blocked on backend                                                                                                                    |
| 7.8   | Reports & Analytics                                                        | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend                                                                                                                    |
| 7.9   | Platform Console                                                           | ✅ done, assumed contract                                            | ⏳ not started                                                                                                                  | ⏳ blocked on backend; billing-provider integration is this phase's real scope                                                           |
| 7.10  | AI Assistant                                                               | ⏳ not started (correctly — blocked on backend's tool-calling layer) | ⏳ not started                                                                                                                  | ⏳ backend's tool-calling layer must land before either side does feature work                                                           |

**Reading this table:** the frontend column is almost entirely "done" already — that's the starting
condition this whole plan was written for, not a milestone to celebrate mid-project. The real work
left in the product is the backend column and, phase by phase, turning each "blocked on backend"
integration cell into "confirmed." Sequence backend phases 0→6 first (closes the MVP), then 7.1
before the rest of 7.x (it unblocks Phase 3's upload primitive retroactively), then the remaining
7.x modules in the order listed, then 7.10 last.
