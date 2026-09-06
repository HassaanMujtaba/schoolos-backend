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
  'parents.read',
  'parents.manage',
  'teachers.read',
  'teachers.manage',
  'admissions.read',
  'admissions.manage',
  'school-setup.manage',
  'timetable.read',
  'timetable.manage',
  'timetable.generate',
  'attendance.read',
  'attendance.mark',
  'attendance.modify',
  'attendance.export',
  'homework.read',
  'homework.manage',
  'homework.grade',
  'exams.read',
  'exams.manage',
  'marks.enter',
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
