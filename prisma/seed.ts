/**
 * Seeds the fixed Role and Permission catalogs — PRD §4's role list and
 * `../implementation-plan.md`'s "Permission catalog" (itself collected verbatim from every
 * `frontend/modules/*.md` doc). Run via `npm run prisma:seed`.
 *
 * Only `super_admin` is granted every permission here. Every other role's actual permission
 * grants are a product decision (which of `students.read`/`students.create`/... does a
 * Receptionist actually get?) that PRD §4 gestures at but doesn't fully enumerate — assign the
 * rest once that's confirmed, rather than guessing a specific matrix into a seed script no one
 * reviewed. Until then, every non-super_admin role exists (so `UserRole` grants are possible
 * for local testing) but starts with zero permissions, which is the fail-closed default.
 */
import { PrismaClient } from '@prisma/client';

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
  'ai.query',
  'ai.generate-content',
  'ai.view-analytics',
];

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

  console.log(
    'Seed complete. Every non-super_admin role has zero permission grants — see this ' +
      "file's own header comment for why, and assign the real per-role matrix once product " +
      'confirms it.',
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
