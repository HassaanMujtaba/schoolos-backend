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
  'Building',
  'Department',
  'User',
  'UserRole',
  'AuditLog',
  // Phase 2 — School Setup & Core Entities (see ../../../implementation-plan.md)
  'School',
  'AcademicYear',
  'Term',
  'Holiday',
  'SchoolClass',
  'Section',
  'Subject',
  // Phase 3 — People + Documents primitive (see ../../../implementation-plan.md)
  'Parent',
  'ParentStudentLink',
  'Student',
  'Enrollment',
  'Teacher',
  'TeacherAssignment',
  'AdmissionApplication',
  'Document',
  'DocumentVersion',
  // Phase 4 — Academics (see ../../../implementation-plan.md)
  'TimetableEntry',
  'Substitution',
  'AttendanceRecord',
  'LeaveRequest',
  'Homework',
  'HomeworkSubmission',
  // Phase 5 — Examinations (see ../../../implementation-plan.md)
  'Exam',
  'ExamMark',
  // Phase 6 — Fees & Finance (see ../../../implementation-plan.md)
  'FeeStructure',
  'Invoice',
  'Payment',
  // Phase 7.1 — Documents & Certificates (see ../../../implementation-plan.md)
  'Certificate',
  // Phase 7.2 — Library (see ../../../implementation-plan.md)
  'LibraryCategory',
  'LibraryShelf',
  'Book',
  'BookCopy',
  'LibraryMember',
  'Loan',
  'Reservation',
  'LibrarySettings',
  // Phase 7.3 — Transport (see ../../../implementation-plan.md)
  'Vehicle',
  'VehicleMaintenanceRecord',
  'Route',
  'RouteStop',
  // Phase 7.4 — Inventory & Assets (see ../../../implementation-plan.md)
  'StockCategory',
  'StockItem',
  'StockMovement',
  'Asset',
  'AssetMaintenanceRecord',
  // Phase 7.5 — Hostel (see ../../../implementation-plan.md)
  'Hostel',
  'Room',
  'Allocation',
  'Visitor',
  'Complaint',
  // Phase 7.6 — HR & Payroll (see ../../../implementation-plan.md)
  'Employee',
  'EmployeeLifecycleEvent',
  'EmployeeLeaveRequest',
  'LeaveBalance',
  'SalaryStructure',
  'PayrollPeriod',
  'Payslip',
  // Phase 7.7 — Communication (see ../../../implementation-plan.md)
  'Notification',
  'NotificationPreference',
  'MessageThread',
  'MessageParticipant',
  'Message',
  'Announcement',
  'Event',
  'PtmSlot',
]);
