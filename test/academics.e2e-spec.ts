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

const ACADEMICS_PERMISSIONS = [
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
];
const READ_ONLY_PERMISSIONS = [
  'timetable.read',
  'attendance.read',
  'homework.read',
];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 4 exit test: the frontend-assumed request/response shapes
 * (`frontend/src/features/{timetable,attendance,homework}/api.ts`) hitting the real endpoints,
 * plus tenant isolation, permission gating, and the `'me'` idiom's documented
 * not-provisioned-yet gap.
 */
describe('Academics — Timetable, Attendance, Homework (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;

  let classId: string;
  let sectionId: string;
  let subjectId: string;
  let teacherId: string;
  let studentAId: string;
  let studentBId: string;

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
    const email = `academics-e2e-${randomUUID()}@example.test`;
    const roleKey = `academics_e2e_role_${randomUUID()}`;
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
        name: 'Academics E2E Tenant A',
        slug: `aca-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Academics E2E Tenant B',
        slug: `acb-${tenantBId}`,
      },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 6', gradeLevel: 6 },
    });
    classId = schoolClass.id;
    const section = await prisma.section.create({
      data: { tenantId: tenantAId, classId, name: 'A', roomLabel: 'Room 6A' },
    });
    sectionId = section.id;
    const academicYear = await prisma.academicYear.create({
      data: {
        tenantId: tenantAId,
        name: '2026-2027',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    const subject = await prisma.subject.create({
      data: {
        tenantId: tenantAId,
        code: 'MATH6',
        name: 'Mathematics',
        type: 'core',
        classIds: [classId],
      },
    });
    subjectId = subject.id;
    const teacher = await prisma.teacher.create({
      data: { tenantId: tenantAId, name: 'Ms. Rivera', employeeId: 'EMP-A1' },
    });
    teacherId = teacher.id;
    await prisma.teacherAssignment.create({
      data: { tenantId: tenantAId, teacherId, subjectId, classId, sectionId },
    });
    const studentA = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'A-ACAD-1',
        name: 'Alice',
        dob: new Date('2015-01-01'),
        gender: 'female',
        classId,
        sectionId,
        academicYearId: academicYear.id,
      },
    });
    studentAId = studentA.id;
    const studentB = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'A-ACAD-2',
        name: 'Bob',
        dob: new Date('2015-02-01'),
        gender: 'male',
        classId,
        sectionId,
        academicYearId: academicYear.id,
      },
    });
    studentBId = studentB.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      ACADEMICS_PERMISSIONS,
      'Academics Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      ACADEMICS_PERMISSIONS,
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

  describe('Timetable', () => {
    let entryId: string;

    it('creates a slot', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/timetable/entries')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          classId,
          sectionId,
          subjectId,
          teacherId,
          roomId: 'Room 6A',
          dayOfWeek: 0,
          periodIndex: 0,
          startTime: '08:00',
          endTime: '08:40',
        });
      expect(res.status).toBe(201);
      entryId = body<{ id: string }>(res).id;
      expect(body<{ dayOfWeek: number }>(res).dayOfWeek).toBe(0);
    });

    it('rejects create for a read-only caller with 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/timetable/entries')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          classId,
          sectionId,
          subjectId,
          teacherId,
          roomId: '',
          dayOfWeek: 1,
          periodIndex: 0,
          startTime: '08:00',
          endTime: '08:40',
        });
      expect(res.status).toBe(403);
    });

    it('rejects an unknown teacher with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/timetable/entries')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          classId,
          sectionId,
          subjectId,
          teacherId: randomUUID(),
          roomId: '',
          dayOfWeek: 1,
          periodIndex: 0,
          startTime: '08:00',
          endTime: '08:40',
        });
      expect(res.status).toBe(400);
    });

    it('the class view returns the created slot', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/timetable')
        .query({ classId, sectionId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const entries = body<{ id: string }[]>(res);
      expect(entries.some((e) => e.id === entryId)).toBe(true);
    });

    it('the teacher view returns the same slot', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/timetable')
        .query({ teacherId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }[]>(res).some((e) => e.id === entryId)).toBe(
        true,
      );
    });

    it('GET /timetable?teacherId=me 404s — no portal user is linked to a Teacher yet (documented gap)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/timetable')
        .query({ teacherId: 'me' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it("resolves 'me' once a Teacher.userId link exists", async () => {
      const linkedUser = await prisma.user.create({
        data: {
          tenantId: tenantAId,
          email: `teacher-me-${randomUUID()}@example.test`,
          name: 'Linked Teacher',
          passwordHash: await bcrypt.hash(password, 10),
          status: 'ACTIVE',
        },
      });
      await prisma.teacher.update({
        where: { id: teacherId },
        data: { userId: linkedUser.id },
      });
      const readPermission = await prisma.permission.findUnique({
        where: { key: 'timetable.read' },
      });
      const readRole = await prisma.role.create({
        data: { key: `teacher_me_role_${randomUUID()}`, label: 'x' },
      });
      if (readPermission) {
        await prisma.rolePermission.create({
          data: { roleId: readRole.id, permissionId: readPermission.id },
        });
      }
      await prisma.userRole.create({
        data: {
          tenantId: tenantAId,
          userId: linkedUser.id,
          roleId: readRole.id,
        },
      });

      const token = await loginAs(linkedUser.email);
      const res = await request(app.getHttpServer())
        .get('/v1/timetable')
        .query({ teacherId: 'me' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }[]>(res).some((e) => e.id === entryId)).toBe(
        true,
      );

      // Clean up the ad-hoc link so later tests see the documented-gap state again.
      await prisma.teacher.update({
        where: { id: teacherId },
        data: { userId: null },
      });
    });

    it('lists every entry unfiltered', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/timetable/entries')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }[]>(res).some((e) => e.id === entryId)).toBe(
        true,
      );
    });

    it('updates the slot', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/timetable/entries/${entryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          classId,
          sectionId,
          subjectId,
          teacherId,
          roomId: 'Room 6A',
          dayOfWeek: 0,
          periodIndex: 1,
          startTime: '08:40',
          endTime: '09:20',
        });
      expect(res.status).toBe(200);
      expect(body<{ periodIndex: number }>(res).periodIndex).toBe(1);
    });

    it("another tenant's caller can't see or touch this entry", async () => {
      const list = await request(app.getHttpServer())
        .get('/v1/timetable/entries')
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(body<{ id: string }[]>(list)).toEqual([]);

      const del = await request(app.getHttpServer())
        .delete(`/v1/timetable/entries/${entryId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(del.status).toBe(404);
    });

    it('generates a timetable for the class/section, replacing prior slots', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/timetable/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ classId, sectionId });
      expect(res.status).toBe(200);
      const entries =
        body<{ id: string; subjectId: string; roomId: string }[]>(res);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((e) => e.subjectId === subjectId)).toBe(true);
      expect(entries.every((e) => e.roomId === 'Room 6A')).toBe(true);

      // The manually-created/updated slot above is gone — generate() replaces the whole class/
      // section, per `timetable.md`'s own contract.
      const stillThere = entries.some((e) => e.id === entryId);
      expect(stillThere).toBe(false);
    });

    it('creates, lists and deletes a substitution', async () => {
      const create = await request(app.getHttpServer())
        .post('/v1/timetable/substitutions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          date: '2026-09-08',
          classId,
          sectionId,
          periodIndex: 0,
          subjectId,
          originalTeacherId: teacherId,
          substituteTeacherId: teacherId,
          reason: 'Sick leave',
        });
      expect(create.status).toBe(201);
      const subId = body<{ id: string }>(create).id;

      const list = await request(app.getHttpServer())
        .get('/v1/timetable/substitutions')
        .query({ date: '2026-09-08' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      expect(body<{ id: string }[]>(list).map((s) => s.id)).toContain(subId);

      const del = await request(app.getHttpServer())
        .delete(`/v1/timetable/substitutions/${subId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(204);
    });
  });

  describe('Attendance', () => {
    let recordAId: string;

    it('submits a full class in one bulk call', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/attendance/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          classId,
          sectionId,
          date: '2026-09-07',
          records: [
            { studentId: studentAId, status: 'present' },
            { studentId: studentBId, status: 'absent' },
          ],
        });
      expect(res.status).toBe(201);
      const records =
        body<{ id: string; studentId: string; status: string }[]>(res);
      expect(records).toHaveLength(2);
      recordAId = records.find((r) => r.studentId === studentAId)!.id;
    });

    it('rejects bulk submit for a read-only caller with 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/attendance/bulk')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          classId,
          sectionId,
          date: '2026-09-07',
          records: [{ studentId: studentAId, status: 'present' }],
        });
      expect(res.status).toBe(403);
    });

    it('re-submitting the same day corrects the record in place (upsert)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/attendance/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          classId,
          sectionId,
          date: '2026-09-07',
          records: [{ studentId: studentAId, status: 'late' }],
        });
      expect(res.status).toBe(201);
      const [record] = body<{ id: string; status: string }[]>(res);
      expect(record.id).toBe(recordAId);
      expect(record.status).toBe('late');
    });

    it('fetches the class/date view', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/attendance')
        .query({ classId, sectionId, date: '2026-09-07' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<unknown[]>(res)).toHaveLength(2);
    });

    it('corrects a single record via PATCH (attendance.modify)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/attendance/${recordAId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'excused' });
      expect(res.status).toBe(200);
      expect(body<{ status: string }>(res).status).toBe('excused');
    });

    it('GET /attendance?studentId=me 404s — no portal user is linked to a Student yet (documented gap)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/attendance')
        .query({ studentId: 'me' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it('the portal history view (real studentId) returns this student only', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/attendance')
        .query({ studentId: studentAId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const records = body<{ studentId: string }[]>(res);
      expect(records.every((r) => r.studentId === studentAId)).toBe(true);
      expect(records.length).toBeGreaterThan(0);
    });

    it('analytics groups by class', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/attendance/analytics')
        .query({ scope: 'daily', groupBy: 'class' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const analytics = body<{
        todayPresentRate: number;
        rows: { id: string; totalCount: number }[];
      }>(res);
      expect(analytics.rows.some((r) => r.id === classId)).toBe(true);
    });

    it('analytics groups by branch as a single tenant-wide row (documented schema gap)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/attendance/analytics')
        .query({ scope: 'daily', groupBy: 'branch' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const analytics = body<{ rows: { id: string; label: string }[] }>(res);
      expect(analytics.rows).toEqual([
        expect.objectContaining({ id: 'all', label: 'All branches' }),
      ]);
    });

    it('exports a CSV (attendance.export)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/attendance/export')
        .query({ scope: 'daily', groupBy: 'class' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.split('\n')[0]).toBe(
        'Label,Present,Absent,Total,Attendance Rate',
      );
    });

    it("another tenant's caller sees no records for this student", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/attendance')
        .query({ studentId: studentAId })
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(200);
      expect(body<unknown[]>(res)).toEqual([]);
    });
  });

  describe('Student leave', () => {
    let leaveId: string;

    it("submits a leave request (staff, on the student's behalf)", async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/leave/student')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          studentId: studentAId,
          startDate: '2026-09-10',
          endDate: '2026-09-11',
          reason: 'Family event',
        });
      expect(res.status).toBe(201);
      const leave = body<{ id: string; status: string; dateRange: unknown }>(
        res,
      );
      leaveId = leave.id;
      expect(leave.status).toBe('pending');
      expect(leave.dateRange).toEqual({ from: '2026-09-10', to: '2026-09-11' });
    });

    it('rejects submission from a caller with no staff permission and no parent link', async () => {
      const bystanderEmail = await createUserWithPermissions(tenantAId, []);
      const bystanderToken = await loginAs(bystanderEmail);
      const res = await request(app.getHttpServer())
        .post('/v1/leave/student')
        .set('Authorization', `Bearer ${bystanderToken}`)
        .send({
          studentId: studentAId,
          startDate: '2026-09-10',
          endDate: '2026-09-11',
          reason: 'Family event',
        });
      expect(res.status).toBe(403);
    });

    it('lists the review queue, filterable by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/leave/student')
        .query({ page: 1, pageSize: 20, status: 'pending' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const paged = body<{ items: { id: string }[]; total: number }>(res);
      expect(paged.items.some((l) => l.id === leaveId)).toBe(true);
    });

    it("lists a single student's own history as a plain array", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/leave/student')
        .query({ studentId: studentAId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(body(res))).toBe(true);
    });

    it('reviews (approves) the request — gated by attendance.modify', async () => {
      const denied = await request(app.getHttpServer())
        .patch(`/v1/leave/student/${leaveId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ status: 'approved' });
      expect(denied.status).toBe(403);

      const res = await request(app.getHttpServer())
        .patch(`/v1/leave/student/${leaveId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved', reviewNotes: 'Approved by admin' });
      expect(res.status).toBe(200);
      expect(body<{ status: string; reviewedBy: string }>(res).status).toBe(
        'approved',
      );
    });
  });

  describe('Homework', () => {
    let homeworkId: string;
    let submissionId: string;

    it('creates a homework assignment (teacherId stamped from the session)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/homework')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Fractions worksheet',
          description: 'Complete pages 1-3',
          links: ['https://example.test/worksheet.pdf'],
          deadline: '2026-09-14T23:59:00.000Z',
          classIds: [classId],
          sectionIds: [],
        });
      expect(res.status).toBe(201);
      const homework = body<{ id: string; teacherId: string }>(res);
      homeworkId = homework.id;
      expect(homework.teacherId).toBeTruthy();
    });

    it('rejects create for a read-only caller with 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/homework')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          title: 'x',
          description: '',
          links: [],
          deadline: '2026-09-14T23:59:00.000Z',
          classIds: [classId],
          sectionIds: [],
        });
      expect(res.status).toBe(403);
    });

    it('lists homework with submission/student counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/homework')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const paged = body<{
        items: { id: string; submissionCount: number; studentCount: number }[];
      }>(res);
      const item = paged.items.find((h) => h.id === homeworkId);
      expect(item).toBeDefined();
      expect(item!.submissionCount).toBe(0);
      expect(item!.studentCount).toBe(2); // studentA + studentB, same class/section
    });

    it('the portal list (studentId scoped) includes mySubmissionStatus: not_submitted', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/homework')
        .query({ page: 1, pageSize: 20, studentId: studentAId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const paged = body<{
        items: { id: string; mySubmissionStatus?: string }[];
      }>(res);
      const item = paged.items.find((h) => h.id === homeworkId);
      expect(item?.mySubmissionStatus).toBe('not_submitted');
    });

    it('POST /homework/:id/submissions 404s for a caller with no linked Student (documented gap)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/homework/${homeworkId}/submissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ textResponse: 'Done!' });
      expect(res.status).toBe(404);
    });

    it("resolves the submitter's own id once Student.userId is linked, and grading updates it", async () => {
      const linkedUser = await prisma.user.create({
        data: {
          tenantId: tenantAId,
          email: `student-me-${randomUUID()}@example.test`,
          name: 'Linked Student',
          passwordHash: await bcrypt.hash(password, 10),
          status: 'ACTIVE',
        },
      });
      await prisma.student.update({
        where: { id: studentAId },
        data: { userId: linkedUser.id },
      });
      const readPermission = await prisma.permission.findUnique({
        where: { key: 'homework.read' },
      });
      const role = await prisma.role.create({
        data: { key: `student_me_role_${randomUUID()}`, label: 'x' },
      });
      if (readPermission) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: readPermission.id },
        });
      }
      await prisma.userRole.create({
        data: { tenantId: tenantAId, userId: linkedUser.id, roleId: role.id },
      });
      const studentToken = await loginAs(linkedUser.email);

      const submit = await request(app.getHttpServer())
        .post(`/v1/homework/${homeworkId}/submissions`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ textResponse: 'Done!' });
      expect(submit.status).toBe(201);
      const submission = body<{
        id: string;
        studentId: string;
        status: string;
      }>(submit);
      submissionId = submission.id;
      expect(submission.studentId).toBe(studentAId);
      expect(submission.status).toBe('submitted');

      const mine = await request(app.getHttpServer())
        .get(`/v1/homework/${homeworkId}/submissions`)
        .query({ studentId: 'me' })
        .set('Authorization', `Bearer ${studentToken}`);
      expect(mine.status).toBe(200);
      expect(body<{ id: string }>(mine).id).toBe(submissionId);

      const graded = await request(app.getHttpServer())
        .patch(`/v1/homework/submissions/${submissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ grade: 'A', feedback: 'Great work' });
      expect(graded.status).toBe(200);
      expect(body<{ status: string; grade: string }>(graded).status).toBe(
        'graded',
      );

      // Clean up the ad-hoc link so later tests see the documented-gap state again.
      await prisma.student.update({
        where: { id: studentAId },
        data: { userId: null },
      });
    });

    it('rejects grading for a read-only caller with 403', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/homework/submissions/${submissionId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ grade: 'B', feedback: 'x' });
      expect(res.status).toBe(403);
    });

    it('the teacher grading queue lists every submission for the assignment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/homework/${homeworkId}/submissions`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }[]>(res).map((s) => s.id)).toContain(
        submissionId,
      );
    });

    it("another tenant's caller can't see this homework", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/homework/${homeworkId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });

    it('deletes the homework', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/homework/${homeworkId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });
  });
});
