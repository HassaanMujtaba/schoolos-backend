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

const EXAM_PERMISSIONS = [
  'exams.read',
  'exams.create',
  'exams.update',
  'results.enter',
  'results.read',
  'results.publish',
];
const READ_ONLY_PERMISSIONS = ['exams.read', 'results.read'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 5 exit test: the frontend-assumed request/response shapes
 * (`frontend/src/features/examinations/api.ts`) hitting the real endpoints, plus tenant isolation,
 * permission gating, the marks-lock/reopen override, grade/GPA/rank computation, and the
 * report-card endpoint's own ownership + publish-state access control.
 */
describe('Examinations (e2e)', () => {
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
    const email = `exams-e2e-${randomUUID()}@example.test`;
    const roleKey = `exams_e2e_role_${randomUUID()}`;
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
        name: 'Exams E2E Tenant A',
        slug: `exa-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Exams E2E Tenant B',
        slug: `exb-${tenantBId}`,
      },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 7', gradeLevel: 7 },
    });
    classId = schoolClass.id;
    const section = await prisma.section.create({
      data: { tenantId: tenantAId, classId, name: 'A', roomLabel: 'Room 7A' },
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
        code: 'MATH7',
        name: 'Mathematics',
        type: 'core',
        classIds: [classId],
      },
    });
    subjectId = subject.id;
    const studentA = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'A-EXAM-1',
        name: 'Alice',
        dob: new Date('2014-01-01'),
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
        admissionNumber: 'A-EXAM-2',
        name: 'Bob',
        dob: new Date('2014-02-01'),
        gender: 'male',
        classId,
        sectionId,
        academicYearId: academicYear.id,
      },
    });
    studentBId = studentB.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      EXAM_PERMISSIONS,
      'Exams Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      EXAM_PERMISSIONS,
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

  describe('Exam setup', () => {
    let examId: string;

    it('creates an exam', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/exams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'midterm',
          subjectId,
          classId,
          sectionId,
          date: '2026-09-10',
          startTime: '09:00',
          endTime: '10:00',
          room: 'Hall A',
          invigilatorId: '',
          maxMarks: 100,
        });
      expect(res.status).toBe(201);
      examId = body<{ id: string }>(res).id;
      expect(body<{ maxMarks: number }>(res).maxMarks).toBe(100);
      // `isPublished` isn't part of the frontend's `Exam` type — must not leak onto this response.
      expect(body<Record<string, unknown>>(res).isPublished).toBeUndefined();
    });

    it('rejects create for a read-only caller with 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/exams')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          type: 'quiz',
          subjectId,
          classId,
          sectionId,
          date: '2026-09-10',
          startTime: '',
          endTime: '',
          room: '',
          invigilatorId: '',
          maxMarks: 10,
        });
      expect(res.status).toBe(403);
    });

    it('rejects a subject not found in this tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/exams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'quiz',
          subjectId: randomUUID(),
          classId,
          sectionId,
          date: '2026-09-10',
          startTime: '',
          endTime: '',
          room: '',
          invigilatorId: '',
          maxMarks: 10,
        });
      expect(res.status).toBe(400);
    });

    it('gets the exam by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/exams/${examId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }>(res).id).toBe(examId);
    });

    it('404s for a wrong-tenant caller', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/exams/${examId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });

    it('updates the exam', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/exams/${examId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'midterm',
          subjectId,
          classId,
          sectionId,
          date: '2026-09-11',
          startTime: '09:00',
          endTime: '10:00',
          room: 'Hall B',
          invigilatorId: '',
          maxMarks: 100,
        });
      expect(res.status).toBe(200);
      expect(body<{ room: string }>(res).room).toBe('Hall B');
    });

    it('lists exams filtered by class/section', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/exams')
        .query({ classId, sectionId, page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const items = body<{ items: { id: string }[] }>(res).items;
      expect(items.some((e) => e.id === examId)).toBe(true);
    });

    it('a read-only caller can still list/get (exams.read)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/exams/${examId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(200);
    });

    describe('Marks entry, results and publish', () => {
      it('marks-entry-sheet has one row per enrolled student, unfilled', async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/exams/${examId}/marks-entry-sheet`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        const sheet = body<{
          maxMarks: number;
          isLocked: boolean;
          rows: { studentId: string; marksObtained: number | null }[];
        }>(res);
        expect(sheet.maxMarks).toBe(100);
        expect(sheet.isLocked).toBe(false);
        expect(sheet.rows.map((r) => r.studentId).sort()).toEqual(
          [studentAId, studentBId].sort(),
        );
        expect(sheet.rows.every((r) => r.marksObtained === null)).toBe(true);
      });

      it('rejects a record missing both marks and isAbsent', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            examId,
            records: [
              { studentId: studentAId, marksObtained: null, isAbsent: false },
            ],
          });
        expect(res.status).toBe(400);
      });

      it('rejects marks above maxMarks', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            examId,
            records: [
              { studentId: studentAId, marksObtained: 150, isAbsent: false },
            ],
          });
        expect(res.status).toBe(400);
      });

      it("rejects a student not in this exam's class/section", async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            examId,
            records: [
              { studentId: randomUUID(), marksObtained: 10, isAbsent: false },
            ],
          });
        expect(res.status).toBe(400);
      });

      it('rejects for a caller without results.enter', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${readOnlyToken}`)
          .send({
            examId,
            records: [
              { studentId: studentAId, marksObtained: 90, isAbsent: false },
            ],
          });
        expect(res.status).toBe(403);
      });

      it('submits bulk marks — one call for both students', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            examId,
            records: [
              { studentId: studentAId, marksObtained: 90, isAbsent: false },
              { studentId: studentBId, marksObtained: 50, isAbsent: false },
            ],
          });
        expect(res.status).toBe(201);
        const rows = body<{ studentId: string; marksObtained: number }[]>(res);
        expect(rows).toHaveLength(2);
      });

      it('resubmitting corrects marks in place (upsert, not duplicate rows)', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            examId,
            records: [
              { studentId: studentAId, marksObtained: 92, isAbsent: false },
              { studentId: studentBId, marksObtained: null, isAbsent: true },
            ],
          });
        expect(res.status).toBe(201);
        const sheet = await request(app.getHttpServer())
          .get(`/v1/exams/${examId}/marks-entry-sheet`)
          .set('Authorization', `Bearer ${adminToken}`);
        const rows = body<{
          rows: {
            studentId: string;
            marksObtained: number | null;
            isAbsent: boolean;
          }[];
        }>(sheet).rows;
        expect(
          rows.find((r) => r.studentId === studentAId)?.marksObtained,
        ).toBe(92);
        expect(rows.find((r) => r.studentId === studentBId)?.isAbsent).toBe(
          true,
        );
      });

      it('computes percentage, grade, GPA and rank — never recomputed client-side', async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/exams/${examId}/results`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        const results = body<{
          isPublished: boolean;
          rows: {
            studentId: string;
            percentage: number | null;
            grade: string | null;
            gpa: number | null;
            rank: number | null;
            isAbsent: boolean;
          }[];
        }>(res);
        expect(results.isPublished).toBe(false);
        const alice = results.rows.find((r) => r.studentId === studentAId)!;
        const bob = results.rows.find((r) => r.studentId === studentBId)!;
        expect(alice.percentage).toBe(92);
        expect(alice.grade).toBe('A+');
        expect(alice.gpa).toBe(4.0);
        expect(alice.rank).toBe(1);
        expect(bob.isAbsent).toBe(true);
        expect(bob.percentage).toBeNull();
        expect(bob.rank).toBeNull();
      });

      it('rejects publish for a caller without results.publish', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/publish`)
          .set('Authorization', `Bearer ${readOnlyToken}`);
        expect(res.status).toBe(403);
      });

      it('locks further marks edits for a caller without results.publish once published', async () => {
        const publishRes = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/publish`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(publishRes.status).toBe(200);
        expect(body<{ isPublished: boolean }>(publishRes).isPublished).toBe(
          true,
        );

        const lockedRole = await createUserWithPermissions(tenantAId, [
          'results.enter',
        ]);
        const lockedToken = await loginAs(lockedRole);
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${lockedToken}`)
          .send({
            examId,
            records: [
              { studentId: studentAId, marksObtained: 95, isAbsent: false },
            ],
          });
        expect(res.status).toBe(409);
      });

      it('a caller holding results.publish can still correct marks through the lock (reopen override)', async () => {
        const res = await request(app.getHttpServer())
          .post(`/v1/exams/${examId}/marks`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            examId,
            records: [
              { studentId: studentAId, marksObtained: 92, isAbsent: false },
            ],
          });
        expect(res.status).toBe(201);
      });
    });

    describe('Report cards', () => {
      it('a results.read staff caller can view the report card', async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/report-cards/${studentAId}`)
          .query({ examId })
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        const card = body<{
          examName: string;
          subjects: { subjectId: string; marksObtained: number | null }[];
          totalMarksObtained: number;
          totalMaxMarks: number;
          percentage: number;
          grade: string | null;
          rank: number | null;
        }>(res);
        expect(card.examName).toBe('Midterm');
        expect(card.subjects).toHaveLength(1);
        expect(card.subjects[0].marksObtained).toBe(92);
        expect(card.totalMaxMarks).toBe(100);
        expect(card.percentage).toBe(92);
        expect(card.grade).toBe('A+');
        expect(card.rank).toBe(1);
      });

      it('is forbidden for a caller with no results.read grant and no ownership link', async () => {
        const bystanderEmail = await createUserWithPermissions(tenantAId, []);
        const bystanderToken = await loginAs(bystanderEmail);
        const res = await request(app.getHttpServer())
          .get(`/v1/report-cards/${studentAId}`)
          .query({ examId })
          .set('Authorization', `Bearer ${bystanderToken}`);
        expect(res.status).toBe(403);
      });

      it('is forbidden for the linked student before results are published', async () => {
        const otherExam = await prisma.exam.create({
          data: {
            tenantId: tenantAId,
            type: 'quiz',
            subjectId,
            classId,
            sectionId,
            date: new Date('2026-09-20'),
            maxMarks: 20,
          },
        });
        await prisma.examMark.create({
          data: {
            tenantId: tenantAId,
            examId: otherExam.id,
            studentId: studentAId,
            marksObtained: 18,
            isAbsent: false,
          },
        });

        const portalUser = await prisma.user.create({
          data: {
            tenantId: tenantAId,
            email: `student-portal-${randomUUID()}@example.test`,
            name: 'Portal Student',
            passwordHash: await bcrypt.hash(password, 10),
            status: 'ACTIVE',
          },
        });
        await prisma.student.update({
          where: { id: studentAId },
          data: { userId: portalUser.id },
        });
        const portalToken = await loginAs(portalUser.email);

        const res = await request(app.getHttpServer())
          .get(`/v1/report-cards/${studentAId}`)
          .query({ examId: otherExam.id })
          .set('Authorization', `Bearer ${portalToken}`);
        expect(res.status).toBe(403);

        // Publish this second exam, then the same portal student succeeds and can use 'me'.
        await prisma.exam.update({
          where: { id: otherExam.id },
          data: { isPublished: true },
        });
        const afterPublish = await request(app.getHttpServer())
          .get(`/v1/report-cards/me`)
          .query({ examId: otherExam.id })
          .set('Authorization', `Bearer ${portalToken}`);
        expect(afterPublish.status).toBe(200);
        expect(body<{ studentId: string }>(afterPublish).studentId).toBe(
          studentAId,
        );

        // A different student's portal login still can't see this one.
        const otherPortalUser = await prisma.user.create({
          data: {
            tenantId: tenantAId,
            email: `student-portal-2-${randomUUID()}@example.test`,
            name: 'Portal Student 2',
            passwordHash: await bcrypt.hash(password, 10),
            status: 'ACTIVE',
          },
        });
        await prisma.student.update({
          where: { id: studentBId },
          data: { userId: otherPortalUser.id },
        });
        const otherPortalToken = await loginAs(otherPortalUser.email);
        const forbidden = await request(app.getHttpServer())
          .get(`/v1/report-cards/${studentAId}`)
          .query({ examId: otherExam.id })
          .set('Authorization', `Bearer ${otherPortalToken}`);
        expect(forbidden.status).toBe(403);

        // Clean up the ad-hoc links so later tests see the documented-gap state again.
        await prisma.student.update({
          where: { id: studentAId },
          data: { userId: null },
        });
        await prisma.student.update({
          where: { id: studentBId },
          data: { userId: null },
        });
      });

      it('a linked parent can view a published report card for their child', async () => {
        const parentUser = await prisma.user.create({
          data: {
            tenantId: tenantAId,
            email: `parent-portal-${randomUUID()}@example.test`,
            name: 'Portal Parent',
            passwordHash: await bcrypt.hash(password, 10),
            status: 'ACTIVE',
          },
        });
        const parent = await prisma.parent.create({
          data: {
            tenantId: tenantAId,
            userId: parentUser.id,
            name: 'Portal Parent',
            phone: '555-0100',
          },
        });
        await prisma.parentStudentLink.create({
          data: {
            tenantId: tenantAId,
            parentId: parent.id,
            studentId: studentAId,
            relation: 'mother',
          },
        });
        const parentToken = await loginAs(parentUser.email);

        // The exam under test (`examId`, published above by the "locks further marks edits" case).
        const res = await request(app.getHttpServer())
          .get(`/v1/report-cards/${studentAId}`)
          .query({ examId })
          .set('Authorization', `Bearer ${parentToken}`);
        expect(res.status).toBe(200);
        expect(body<{ studentId: string }>(res).studentId).toBe(studentAId);

        // Not their child.
        const notMyChild = await request(app.getHttpServer())
          .get(`/v1/report-cards/${studentBId}`)
          .query({ examId })
          .set('Authorization', `Bearer ${parentToken}`);
        expect(notMyChild.status).toBe(403);
      });
    });
  });
});
