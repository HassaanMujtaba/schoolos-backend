import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';

function body<T>(res: request.Response): T {
  return res.body as T;
}

function truncateToDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function daysFromToday(offset: number): Date {
  const date = truncateToDate(new Date());
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}

function todayAtNoonUtc(): Date {
  const date = truncateToDate(new Date());
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const REPORTS_PERMISSIONS = ['reports.read', 'reports.export'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.8 exit test:
 * `frontend/src/features/reports/api.ts`'s assumed shapes hitting the real endpoints. This module
 * is pure aggregation over data every other module already owns, so unlike every earlier phase's
 * own e2e spec, the underlying `AttendanceRecord`/`Exam`/`ExamMark`/`Invoice`/`Payment`/
 * `PayrollPeriod`/`Payslip`/`AdmissionApplication` fixtures below are written directly via Prisma
 * rather than replayed through each owning module's own API — those flows are already covered by
 * their own e2e specs; this one verifies the aggregation math, the `reports.read`/`reports.export`
 * gates, tenant isolation, and the export endpoint's binary responses.
 */
describe('Reports & Analytics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;

  let classId: string;
  let mathSubjectId: string;

  const password = 'correct horse battery staple';

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    expect(res.status).toBe(200);
    return body<{ accessToken: string }>(res).accessToken;
  }

  async function createUserWithPermissions(
    tenantId: string,
    permissionKeys: string[],
    name = 'E2E User',
  ): Promise<string> {
    const email = `reports-e2e-${randomUUID()}@example.test`;
    const roleKey = `reports_e2e_role_${randomUUID()}`;
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    const role = await prisma.role.create({
      data: { key: roleKey, label: roleKey },
    });
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { tenantId, email, name, passwordHash, status: 'ACTIVE' },
    });
    await prisma.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id },
    });
    return email;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    prisma = app.get(PlatformPrismaService);

    tenantAId = randomUUID();
    tenantBId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantAId,
        name: 'Reports E2E Tenant A',
        slug: `ra-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Reports E2E Tenant B',
        slug: `rb-${tenantBId}`,
      },
    });

    await prisma.school.create({
      data: { tenantId: tenantAId, name: 'Reports E2E School' },
    });

    // Term — wide enough that "today" always falls inside it, so the dashboard/academic-report
    // "current term" scoping never falls back to the trailing-90-day window (see
    // `ReportsService`'s own header comment).
    const academicYear = await prisma.academicYear.create({
      data: {
        tenantId: tenantAId,
        name: 'Reports E2E Year',
        startDate: daysFromToday(-200),
        endDate: daysFromToday(200),
      },
    });
    await prisma.term.create({
      data: {
        tenantId: tenantAId,
        academicYearId: academicYear.id,
        name: 'Reports E2E Term',
        startDate: daysFromToday(-60),
        endDate: daysFromToday(60),
      },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 9', gradeLevel: 9 },
    });
    classId = schoolClass.id;
    const section = await prisma.section.create({
      data: { tenantId: tenantAId, classId, name: 'A', roomLabel: 'Room 9A' },
    });
    const sectionId = section.id;

    const mathSubject = await prisma.subject.create({
      data: {
        tenantId: tenantAId,
        code: 'MATH9',
        name: 'Mathematics',
        type: 'core',
        classIds: [classId],
      },
    });
    mathSubjectId = mathSubject.id;
    const scienceSubject = await prisma.subject.create({
      data: {
        tenantId: tenantAId,
        code: 'SCI9',
        name: 'Science',
        type: 'core',
        classIds: [classId],
      },
    });
    const scienceSubjectId = scienceSubject.id;

    const studentA = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'R-EA-1',
        name: 'Reports Alice',
        dob: new Date('2014-01-01'),
        gender: 'female',
        classId,
        sectionId,
        academicYearId: academicYear.id,
        status: 'active',
      },
    });
    const studentB = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'R-EA-2',
        name: 'Reports Bob',
        dob: new Date('2014-02-01'),
        gender: 'male',
        classId,
        sectionId,
        academicYearId: academicYear.id,
        status: 'active',
      },
    });
    // Inactive — must not count toward `totalStudents`.
    await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'R-EA-3',
        name: 'Reports Carol (graduated)',
        dob: new Date('2013-01-01'),
        gender: 'female',
        classId,
        sectionId,
        academicYearId: academicYear.id,
        status: 'graduated',
      },
    });

    const teacherMath = await prisma.teacher.create({
      data: { tenantId: tenantAId, name: 'Ms. Math', employeeId: 'T-MATH' },
    });
    const teacherScience = await prisma.teacher.create({
      data: { tenantId: tenantAId, name: 'Mr. Science', employeeId: 'T-SCI' },
    });
    await prisma.teacherAssignment.create({
      data: {
        tenantId: tenantAId,
        teacherId: teacherMath.id,
        subjectId: mathSubjectId,
        classId,
        sectionId,
      },
    });
    await prisma.teacherAssignment.create({
      data: {
        tenantId: tenantAId,
        teacherId: teacherScience.id,
        subjectId: scienceSubjectId,
        classId,
        sectionId,
      },
    });

    // Exams — one published per subject (marks below), plus one unpublished exam whose marks must
    // never move any number (ReportsService only reads `isPublished` exams).
    const examMath = await prisma.exam.create({
      data: {
        tenantId: tenantAId,
        type: 'midterm',
        subjectId: mathSubjectId,
        classId,
        sectionId,
        date: daysFromToday(-5),
        maxMarks: 100,
        isPublished: true,
      },
    });
    const examScience = await prisma.exam.create({
      data: {
        tenantId: tenantAId,
        type: 'midterm',
        subjectId: scienceSubjectId,
        classId,
        sectionId,
        date: daysFromToday(-5),
        maxMarks: 50,
        isPublished: true,
      },
    });
    const examUnpublished = await prisma.exam.create({
      data: {
        tenantId: tenantAId,
        type: 'quiz',
        subjectId: mathSubjectId,
        classId,
        sectionId,
        date: daysFromToday(-5),
        maxMarks: 10,
        isPublished: false,
      },
    });

    // Math: 90 (A+, pass) and 30 (F, fail) — avg 60, pass rate 50%.
    await prisma.examMark.create({
      data: {
        tenantId: tenantAId,
        examId: examMath.id,
        studentId: studentA.id,
        marksObtained: 90,
        isAbsent: false,
      },
    });
    await prisma.examMark.create({
      data: {
        tenantId: tenantAId,
        examId: examMath.id,
        studentId: studentB.id,
        marksObtained: 30,
        isAbsent: false,
      },
    });
    // Science: 45/50 = 90% (A+, pass) for A; B absent — excluded, not a 0.
    await prisma.examMark.create({
      data: {
        tenantId: tenantAId,
        examId: examScience.id,
        studentId: studentA.id,
        marksObtained: 45,
        isAbsent: false,
      },
    });
    await prisma.examMark.create({
      data: {
        tenantId: tenantAId,
        examId: examScience.id,
        studentId: studentB.id,
        marksObtained: null,
        isAbsent: true,
      },
    });
    // Unpublished — must never surface.
    await prisma.examMark.create({
      data: {
        tenantId: tenantAId,
        examId: examUnpublished.id,
        studentId: studentA.id,
        marksObtained: 10,
        isAbsent: false,
      },
    });

    // Attendance — today only, so it lands in the current (last) weekly trend bucket.
    await prisma.attendanceRecord.create({
      data: {
        tenantId: tenantAId,
        studentId: studentA.id,
        classId,
        sectionId,
        date: daysFromToday(0),
        status: 'present',
      },
    });
    await prisma.attendanceRecord.create({
      data: {
        tenantId: tenantAId,
        studentId: studentB.id,
        classId,
        sectionId,
        date: daysFromToday(0),
        status: 'absent',
      },
    });

    // Fees — one invoice, partially paid: totalAmount 1000, paidAmount 400 -> outstanding 600.
    const feeStructure = await prisma.feeStructure.create({
      data: {
        tenantId: tenantAId,
        name: 'Reports E2E Tuition',
        type: 'tuition',
        amount: 1000,
        applicableClasses: [classId],
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenantAId,
        studentId: studentA.id,
        feeStructureId: feeStructure.id,
        dueDate: daysFromToday(0),
        status: 'partial',
        totalAmount: 1000,
        paidAmount: 400,
      },
    });
    await prisma.payment.create({
      data: {
        tenantId: tenantAId,
        invoiceId: invoice.id,
        amount: 400,
        method: 'cash',
        receiptNumber: `R-${randomUUID()}`,
        paidAt: todayAtNoonUtc(),
        refunded: false,
      },
    });

    // Payroll — one approved period overlapping today, one payslip (the only "expense" this
    // schema tracks — see `ReportsService`'s own header comment).
    const employee = await prisma.employee.create({
      data: {
        tenantId: tenantAId,
        name: 'Reports Employee',
        employeeId: 'EMP-REPORTS-1',
        department: 'Administration',
        designation: 'Clerk',
        employmentType: 'full_time',
        dateOfJoining: daysFromToday(-400),
        status: 'active',
      },
    });
    const payrollPeriod = await prisma.payrollPeriod.create({
      data: {
        tenantId: tenantAId,
        label: 'Reports E2E Period',
        startDate: daysFromToday(-15),
        endDate: daysFromToday(15),
        status: 'approved',
      },
    });
    await prisma.payslip.create({
      data: {
        tenantId: tenantAId,
        periodId: payrollPeriod.id,
        employeeId: employee.id,
        basicSalary: 4500,
        allowances: 500,
        tax: 0,
        deductions: 0,
        loanDeduction: 0,
        netPay: 5000,
      },
    });

    // Admissions — one application created "now", inside the term window.
    await prisma.admissionApplication.create({
      data: {
        tenantId: tenantAId,
        applicantName: 'Reports Applicant',
        applicantDob: new Date('2015-01-01'),
        classAppliedFor: classId,
        contactPhone: '555-0100',
      },
    });

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      REPORTS_PERMISSIONS,
      'Reports Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(tenantAId, []);
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      REPORTS_PERMISSIONS,
    );

    adminToken = await loginAs(adminEmail);
    readOnlyToken = await loginAs(readOnlyEmail);
    tenantBToken = await loginAs(tenantBEmail);
  });

  afterAll(async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await prisma.userRole.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await app.close();
  });

  describe('Principal dashboard', () => {
    it('rejects a caller without reports.read', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/principal-dashboard')
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('aggregates students/teachers/attendance/fees/admissions/academic performance', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/principal-dashboard')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const dashboard = body<{
        totalStudents: number;
        totalTeachers: number;
        attendanceRatePct: number;
        feesCollected: number;
        outstandingFees: number;
        admissionsThisTerm: number;
        academicPerformancePct: number;
      }>(res);
      // Only the two active students — the graduated one is excluded.
      expect(dashboard.totalStudents).toBe(2);
      expect(dashboard.totalTeachers).toBe(2);
      // 1 present of 2 records marked today.
      expect(dashboard.attendanceRatePct).toBe(50);
      expect(dashboard.feesCollected).toBe(400);
      expect(dashboard.outstandingFees).toBe(600);
      expect(dashboard.admissionsThisTerm).toBe(1);
      // Mean of 90, 30, 90 across the three published, non-absent marks.
      expect(dashboard.academicPerformancePct).toBe(70);
    });

    it('is tenant-isolated — a fresh tenant with no data reads all zeros', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/principal-dashboard')
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(200);
      const dashboard = body<{ totalStudents: number; feesCollected: number }>(
        res,
      );
      expect(dashboard.totalStudents).toBe(0);
      expect(dashboard.feesCollected).toBe(0);
    });
  });

  describe('Academic report', () => {
    it('rejects a caller without reports.read', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/academic')
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('computes pass rate, per-class/subject/teacher performance and grade distribution', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/academic')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const report = body<{
        overallPassRatePct: number;
        classPerformance: {
          className: string;
          averageScorePct: number;
          passRatePct: number;
        }[];
        subjectPerformance: {
          subjectName: string;
          averageScorePct: number;
          passRatePct: number;
        }[];
        gradeDistribution: { grade: string; count: number }[];
        attendanceTrend: { period: string; attendanceRatePct: number }[];
        teacherPerformance: { teacherName: string; averageScorePct: number }[];
      }>(res);

      // 2 of 3 in-scope marks pass (90, 30, 90 -> only 30 is an F).
      expect(report.overallPassRatePct).toBeCloseTo(66.67, 1);

      expect(report.classPerformance).toHaveLength(1);
      expect(report.classPerformance[0].className).toBe('Grade 9');
      expect(report.classPerformance[0].averageScorePct).toBe(70);

      const bySubject = Object.fromEntries(
        report.subjectPerformance.map((s) => [s.subjectName, s]),
      );
      expect(bySubject.Mathematics.averageScorePct).toBe(60);
      expect(bySubject.Mathematics.passRatePct).toBe(50);
      expect(bySubject.Science.averageScorePct).toBe(90);
      expect(bySubject.Science.passRatePct).toBe(100);

      const gradeCounts = Object.fromEntries(
        report.gradeDistribution.map((g) => [g.grade, g.count]),
      );
      expect(gradeCounts['A+']).toBe(2);
      expect(gradeCounts.F).toBe(1);
      expect(report.gradeDistribution).toHaveLength(8); // every band always present, per ReportsService's own doc comment

      expect(report.attendanceTrend).toHaveLength(8);
      expect(report.attendanceTrend[7].attendanceRatePct).toBe(50); // today's bucket, last in the array

      const byTeacher = Object.fromEntries(
        report.teacherPerformance.map((t) => [
          t.teacherName,
          t.averageScorePct,
        ]),
      );
      expect(byTeacher['Ms. Math']).toBe(60);
      expect(byTeacher['Mr. Science']).toBe(90);
    });

    it('narrows every table to one subject when subjectId is passed', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/academic')
        .query({ subjectId: mathSubjectId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const report = body<{
        subjectPerformance: { subjectName: string }[];
        teacherPerformance: { teacherName: string }[];
      }>(res);
      expect(report.subjectPerformance.map((s) => s.subjectName)).toEqual([
        'Mathematics',
      ]);
      expect(report.teacherPerformance.map((t) => t.teacherName)).toEqual([
        'Ms. Math',
      ]);
    });
  });

  describe('Financial report', () => {
    it('rejects a caller without reports.read', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/financial')
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('computes revenue, expenses, collection rate and outstanding for the given range', async () => {
      const today = isoDate(daysFromToday(0));
      const res = await request(app.getHttpServer())
        .get('/v1/reports/financial')
        .query({ from: today, to: today })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const report = body<{
        totalRevenue: number;
        totalExpenses: number;
        collectionRatePct: number;
        outstandingTotal: number;
        trend: { period: string; revenue: number; expenses: number }[];
      }>(res);
      expect(report.totalRevenue).toBe(400);
      expect(report.totalExpenses).toBe(5000);
      expect(report.collectionRatePct).toBe(40); // 400 collected of 1000 billed (invoice due today)
      expect(report.outstandingTotal).toBe(600);
      expect(report.trend).toHaveLength(1);
      expect(report.trend[0].revenue).toBe(400);
      expect(report.trend[0].expenses).toBe(5000);
    });

    it('rejects a malformed date', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/financial')
        .query({ from: 'not-a-date' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Export', () => {
    it('rejects a caller without reports.export', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/principal-dashboard/export')
        .query({ format: 'csv' })
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('400s an unknown report id', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/not-a-real-report/export')
        .query({ format: 'csv' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });

    it('exports the principal dashboard as CSV with real numbers inline', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/principal-dashboard/export')
        .query({ format: 'csv' })
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const text = (res.body as Buffer).toString('utf-8');
      expect(text).toContain('Total students');
      expect(text).toContain('600.00'); // outstanding fees
    });

    it('exports the academic report as a real PDF', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/academic/export')
        .query({ format: 'pdf' })
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('academic.pdf');
      const bytes = res.body as Buffer;
      expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('exports the financial report as a real xlsx workbook', async () => {
      const today = isoDate(daysFromToday(0));
      const res = await request(app.getHttpServer())
        .get('/v1/reports/financial/export')
        .query({ format: 'excel', from: today, to: today })
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('financial.xlsx');
      const bytes = res.body as Buffer;
      // xlsx is a zip archive — "PK" local-file-header signature.
      expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    });
  });
});
