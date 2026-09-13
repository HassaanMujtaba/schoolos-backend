/**
 * Seeds the fixed Role and Permission catalogs — PRD §4's role list and
 * `../implementation-plan.md`'s "Permission catalog" (itself collected verbatim from every
 * `frontend/modules/*.md` doc). Run via `npm run prisma:seed`.
 *
 * `super_admin` is granted every permission here, `school_owner` every *non-platform* one (owning
 * a school implies full control of that school, not a guess the way a Receptionist's or Teacher's
 * exact permission set would be — see `SCHOOL_OWNER_PERMISSIONS` below). Every other role's actual
 * permission grants are still a product decision (which of `students.read`/`students.create`/...
 * does a Receptionist actually get?) that PRD §4 gestures at but doesn't fully enumerate, so they
 * start with zero — the fail-closed default — rather than a guessed-into-a-seed-script matrix.
 * Unlike before, "zero and stuck" is no longer the end of the story: `platform/roles.controller.ts`
 * (Super Admin only, `platform.roles.manage`) now lets a real permission matrix be assigned to
 * every other role after the fact, without another migration or reseed.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// PRD §4 — Platform role, then School roles.
const ROLES: Array<{ key: string; label: string }> = [
  { key: 'super_admin', label: 'Super Admin' },
  { key: 'school_owner', label: 'School Owner' },
  { key: 'school_admin', label: 'School Admin' },
  { key: 'principal', label: 'Principal' },
  { key: 'vice_principal', label: 'Vice Principal' },
  { key: 'academic_coordinator', label: 'Academic Coordinator' },
  { key: 'teacher', label: 'Teacher' },
  { key: 'accountant', label: 'Accountant' },
  { key: 'hr_manager', label: 'HR Manager' },
  { key: 'receptionist', label: 'Receptionist' },
  { key: 'librarian', label: 'Librarian' },
  { key: 'transport_manager', label: 'Transport Manager' },
  { key: 'driver', label: 'Driver' },
  { key: 'nurse', label: 'Nurse' },
  { key: 'hostel_warden', label: 'Hostel Warden' },
  { key: 'inventory_manager', label: 'Inventory Manager' },
  { key: 'student', label: 'Student' },
  { key: 'parent', label: 'Parent' },
];

// ../implementation-plan.md "Permission catalog" — kept in the same grouping/order as that doc so
// the two are easy to diff against each other.
const PERMISSIONS: string[] = [
  'students.read',
  'students.create',
  'students.update',
  'students.delete',
  'students.export',
  // Phase 3 (People) — corrected the same way Phase 2's school-setup row was: the
  // `parents.manage`/`teachers.manage`/`admissions.manage` buckets below were this catalog's
  // original draft, but the actually-built frontend (`ChildLinkPanel.tsx`, `StagePanels.tsx`,
  // `TeacherForm`/`AssignmentPanel`, all via `usePermission`) calls granular per-action strings
  // instead — see ../implementation-plan.md's Phase 3 section.
  'parents.read',
  'parents.create',
  'parents.update',
  'parents.delete',
  'teachers.read',
  'teachers.create',
  'teachers.update',
  'teachers.delete',
  'teachers.assign',
  'admissions.read',
  'admissions.create',
  'admissions.update',
  'admissions.review',
  'admissions.approve',
  'admissions.reject',
  // Phase 2 (School Setup & Core Entities) — corrected from the placeholder
  // `school-setup.manage` bucket to the granular strings the built frontend actually calls
  // `usePermission`/`RequirePermission` with (`router.tsx`, `navConfig.ts`, and every
  // `features/school-setup` form/table) — see ../implementation-plan.md's Phase 2 section.
  'school.read',
  'school.update',
  'branches.read',
  'branches.create',
  'branches.update',
  'branches.delete',
  'academic-years.read',
  'academic-years.create',
  'academic-years.update',
  'academic-years.delete',
  'classes.read',
  'classes.create',
  'classes.update',
  'classes.delete',
  'sections.read',
  'sections.create',
  'sections.update',
  'sections.delete',
  'subjects.read',
  'subjects.create',
  'subjects.update',
  'subjects.delete',
  // Phase 4 (Academics) — corrected the same way Phase 2/3's rows were: `timetable.manage`/
  // `timetable.generate` and `homework.manage` below were this catalog's original draft, but the
  // actually-built frontend (`TimetableGridPage.tsx`/`SubstitutionsTable.tsx`'s single
  // `usePermission('timetable.update')` gate for all editing/generation/substitution actions;
  // `HomeworkList.tsx`/`HomeworkListPage.tsx`'s granular `usePermission('homework.create'/
  // 'homework.update'/'homework.delete')`) calls different strings — see
  // ../implementation-plan.md's Phase 4 section. `homework.grade` is kept (PRD §4's own catalog
  // entry) even though nothing client-side gates the grading form on it yet — server-side
  // enforcement doesn't depend on the frontend checking it first.
  'timetable.read',
  'timetable.update',
  'attendance.read',
  'attendance.mark',
  'attendance.modify',
  'attendance.export',
  'homework.read',
  'homework.create',
  'homework.update',
  'homework.delete',
  'homework.grade',
  // Phase 5 (Examinations) — corrected the same way every earlier phase's own row was: the
  // `exams.manage`/`marks.enter` placeholders below were this catalog's original draft, but the
  // actually-built frontend (`ExamsTable.tsx`'s `usePermission('exams.update'/'results.enter'/
  // 'results.read')`, `ExamsListPage.tsx`'s `usePermission('exams.create')`, `ResultsPage.tsx`'s
  // `usePermission('results.publish')`) calls different strings — see
  // ../implementation-plan.md's Phase 5 section. `exams.read` is kept (gates `GET /exams`/
  // `GET /exams/:id` server-side, same "not client-gated but still enforced" reasoning as
  // `homework.grade`) even though nothing client-side checks it before rendering the exams list.
  'exams.read',
  'exams.create',
  'exams.update',
  'results.enter',
  'results.read',
  'results.publish',
  'fees.read',
  'fees.create',
  'fees.collect',
  'fees.refund',
  'fees.delete',
  'library.read',
  'library.manage-catalog',
  'library.circulate',
  'transport.read',
  'transport.manage',
  'transport.track',
  'inventory.read',
  'inventory.manage',
  'assets.read',
  'assets.manage',
  'hostel.read',
  'hostel.manage',
  'hostel.allocate',
  'hr.read',
  'hr.manage',
  'payroll.read',
  'payroll.run',
  'payroll.approve',
  'leave.request',
  'leave.approve',
  'messages.send',
  'announcements.read',
  'announcements.create',
  'events.manage',
  'ptm.manage',
  'ptm.book',
  'documents.read',
  'documents.upload',
  'documents.delete',
  'certificates.generate',
  'certificates.read',
  'reports.read',
  'reports.export',
  'platform.schools.manage',
  'platform.subscriptions.manage',
  'platform.billing.read',
  'platform.feature-flags.manage',
  'platform.support.read',
  'platform.audit.read',
  'platform.roles.manage',
  'ai.query',
  'ai.generate-content',
  'ai.view-analytics',
];

// Phase 7.9 (Platform Console) — PRD §53's three fixed tiers. `priceMonthly` in dollars (matches
// `Invoice.totalAmount`'s own convention); `stripePriceId: null` until a real Stripe account's
// price ids are configured (`platform/billing-provider.ts`'s own doc comment — `LocalBillingProvider`
// never reads this field at all).
const PLANS: Array<{
  tier: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  name: string;
  priceMonthly: number;
  maxBranches: number;
  maxStudents: number;
  features: string[];
}> = [
  {
    tier: 'STARTER',
    name: 'Starter',
    priceMonthly: 49,
    maxBranches: 1,
    maxStudents: 300,
    features: [
      'Core academics & attendance',
      'Fee collection',
      'Parent portal',
    ],
  },
  {
    tier: 'PROFESSIONAL',
    name: 'Professional',
    priceMonthly: 149,
    maxBranches: 5,
    maxStudents: 2000,
    features: [
      'Everything in Starter',
      'Examinations & report cards',
      'Library, transport & inventory',
      'HR & payroll',
    ],
  },
  {
    tier: 'ENTERPRISE',
    name: 'Enterprise',
    priceMonthly: 399,
    maxBranches: 50,
    maxStudents: 20000,
    features: [
      'Everything in Professional',
      'Hostel management',
      'Advanced reports & analytics',
      'Priority support',
    ],
  },
];

// Phase 7.9 — a small, fixed catalog (self-service flag *creation* isn't built this phase,
// `schema.prisma`'s own `FeatureFlag` doc comment). `hostel_module` is `hostel.md`'s own deferred
// "not every tenant is a boarding school" gating question (`../implementation-plan.md`'s Phase 7.5
// notes) — this is that catalog entry, not yet consumed by `hostel/` itself (see this row's own
// module-doc cross-reference there).
const FEATURE_FLAGS: Array<{
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}> = [
  {
    key: 'hostel_module',
    label: 'Hostel management',
    description:
      'Shows the Hostel module for boarding schools. Off by default — most tenants are day schools.',
    enabled: false,
  },
  {
    key: 'ai_assistant',
    label: 'AI assistant',
    description:
      'School Assistant / Teacher Assistant (PRD §34/§35, Phase 7.10 — not built yet).',
    enabled: false,
  },
  {
    key: 'transport_live_tracking',
    label: 'Transport live tracking',
    description:
      'Live vehicle location on the transport map (module doc: not built either side yet).',
    enabled: false,
  },
  {
    key: 'communication_realtime',
    label: 'Realtime messaging',
    description:
      'The `/ws` gateway-backed live message/notification delivery in Communication.',
    enabled: true,
  },
];

// Phase 7.9 — a Super Admin has to belong to *some* tenant (`User.tenantId` is required, unchanged
// by this phase — see `schools.service.ts`'s own comment on why a dedicated housekeeping tenant
// was the chosen fix rather than making that column nullable across every earlier phase's already-
// shipped auth code). This tenant deliberately has no `School` row — `SchoolsService`/
// `PlatformUsersService` both filter on `school: { isNot: null }` specifically so this account
// never shows up in a schools list or a support user search.
const PLATFORM_TENANT_SLUG = 'platform-console';
const SUPER_ADMIN_EMAIL =
  process.env.SUPER_ADMIN_EMAIL ?? 'super-admin@schoolos.dev';
// Dev-only default, same spirit as JWT_ACCESS_SECRET's ".env.example" placeholder — set
// SUPER_ADMIN_PASSWORD for real in every non-local environment.
const SUPER_ADMIN_PASSWORD =
  process.env.SUPER_ADMIN_PASSWORD ?? 'dev-only-change-me-super-admin';

async function main() {
  console.log(
    `Seeding ${PERMISSIONS.length} permissions and ${ROLES.length} roles...`,
  );

  const permissionRecords = await Promise.all(
    PERMISSIONS.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, label: key },
      }),
    ),
  );

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      update: { label: role.label },
      create: { key: role.key, label: role.label },
    });
  }

  const superAdmin = await prisma.role.findUniqueOrThrow({
    where: { key: 'super_admin' },
  });
  await prisma.rolePermission.createMany({
    data: permissionRecords.map((permission) => ({
      roleId: superAdmin.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  // `school_owner` gets every permission *except* `platform.*` — those are platform-staff-only by
  // construction (every `platform/*.controller.ts` route gates purely on the permission string,
  // with no separate "is this actually platform staff" check), so granting one to a tenant role
  // would hand every school_owner cross-tenant platform access. `platform/roles.service.ts`
  // enforces this same rule server-side for any *future* edit through the admin UI — this is just
  // the seed's own starting point, not the only place it's checked.
  const schoolOwner = await prisma.role.findUniqueOrThrow({
    where: { key: 'school_owner' },
  });
  const schoolOwnerPermissions = permissionRecords.filter(
    (permission) => !permission.key.startsWith('platform.'),
  );
  await prisma.rolePermission.createMany({
    data: schoolOwnerPermissions.map((permission) => ({
      roleId: schoolOwner.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  console.log(
    `Seeding ${PLANS.length} plans and ${FEATURE_FLAGS.length} feature flags...`,
  );

  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { tier: plan.tier },
      update: {
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        maxBranches: plan.maxBranches,
        maxStudents: plan.maxStudents,
        features: plan.features,
      },
      create: plan,
    });
  }

  for (const flag of FEATURE_FLAGS) {
    // Not `upsert` with the `key_tenantId` compound-unique shorthand — Prisma's generated type
    // for that requires a non-null `tenantId` (Postgres itself treats two NULLs in a unique index
    // as distinct, so "the" row with `tenantId: null` isn't something a compound-unique lookup can
    // even express); `findFirst` + create-or-update by id is the correct way to upsert a
    // nullable-column half of a compound key.
    const existing = await prisma.featureFlag.findFirst({
      where: { key: flag.key, tenantId: null },
    });
    if (existing) {
      await prisma.featureFlag.update({
        where: { id: existing.id },
        data: { label: flag.label, description: flag.description },
      });
    } else {
      await prisma.featureFlag.create({
        data: { ...flag, scope: 'PLATFORM', tenantId: null },
      });
    }
  }

  console.log(
    `Seeding the platform housekeeping tenant + Super Admin account...`,
  );

  const platformTenant = await prisma.tenant.upsert({
    where: { slug: PLATFORM_TENANT_SLUG },
    update: {},
    create: { name: 'Platform', slug: PLATFORM_TENANT_SLUG, status: 'ACTIVE' },
  });
  const superAdminUser = await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: platformTenant.id, email: SUPER_ADMIN_EMAIL },
    },
    update: {},
    create: {
      tenantId: platformTenant.id,
      email: SUPER_ADMIN_EMAIL,
      name: 'Super Admin',
      passwordHash: bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 12),
      status: 'ACTIVE',
    },
  });
  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: superAdminUser.id, roleId: superAdmin.id },
    },
    update: {},
    create: {
      tenantId: platformTenant.id,
      userId: superAdminUser.id,
      roleId: superAdmin.id,
    },
  });

  console.log(
    'Seed complete. school_owner has every non-platform permission; every other non-' +
      "super_admin role has zero — see this file's own header comment for why, and assign the " +
      'real per-role matrix via /platform/roles (Super Admin only) once product confirms it. ' +
      'Log in to /platform as the seeded Super Admin with SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD ' +
      '(or the dev defaults above) once this has run.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
