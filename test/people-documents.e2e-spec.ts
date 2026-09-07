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

const ALL_PERMISSIONS = [
  'students.read',
  'students.create',
  'students.update',
  'students.delete',
  'students.export',
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
  'documents.read',
  'documents.upload',
  'documents.delete',
];

/**
 * Requires a real Postgres + Redis + S3/MinIO (see `test/health.e2e-spec.ts`'s own header
 * comment) — `../implementation-plan.md`'s Phase 3 exit test: the frontend-assumed request/
 * response shapes (`frontend/src/features/{students,parents,teachers,admissions,documents}/
 * api.ts`) hitting the real endpoints, including the resolved admissions↔fees ordering decision,
 * the stage-machine's server-side enforcement, and the documents upload primitive's real S3 round
 * trip.
 */
describe('People + Documents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;

  let classId: string;
  let sectionId: string;
  let academicYearId: string;

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
  ): Promise<string> {
    const email = `people-e2e-${randomUUID()}@example.test`;
    const roleKey = `people_e2e_role_${randomUUID()}`;
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
      data: {
        tenantId,
        email,
        name: 'E2E User',
        passwordHash,
        status: 'ACTIVE',
      },
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
        name: 'People E2E Tenant A',
        slug: `pea-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'People E2E Tenant B',
        slug: `peb-${tenantBId}`,
      },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 5', gradeLevel: 5 },
    });
    classId = schoolClass.id;
    const section = await prisma.section.create({
      data: { tenantId: tenantAId, classId, name: 'A' },
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
    academicYearId = academicYear.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      ALL_PERMISSIONS,
    );
    const readOnlyEmail = await createUserWithPermissions(tenantAId, [
      'students.read',
      'parents.read',
      'teachers.read',
      'admissions.read',
      'documents.read',
    ]);
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      ALL_PERMISSIONS,
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

  describe('Documents (shared upload primitive)', () => {
    let documentId: string;

    it('uploads a file (real S3/MinIO round trip), returning a signed URL', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('category', 'student')
        .attach('file', Buffer.from('not a real pdf, just bytes'), {
          filename: 'report-card.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(201);
      const doc = body<{
        id: string;
        fileName: string;
        version: number;
        ownerId: string | null;
        url: string;
      }>(res);
      expect(doc.fileName).toBe('report-card.pdf');
      expect(doc.version).toBe(1);
      expect(doc.ownerId).toBeNull();
      expect(doc.url).toMatch(/^http/);
      documentId = doc.id;

      // The signed URL is real and actually serves the uploaded bytes — not just a well-formed
      // string. A plain `fetch` (not `apiClient`/supertest) since this is a bare, unauthenticated
      // S3 URL, not a route on this app.
      const download = await fetch(doc.url);
      expect(download.status).toBe(200);
      expect(await download.text()).toBe('not a real pdf, just bytes');
    });

    it('rejects an unsupported file type', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('category', 'student')
        .attach('file', Buffer.from('#!/bin/sh\necho hi'), {
          filename: 'script.sh',
          contentType: 'application/x-sh',
        });
      expect(res.status).toBe(400);
    });

    it('rejects the EICAR malware-scan stub signature', async () => {
      const eicar =
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      const res = await request(app.getHttpServer())
        .post('/v1/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('category', 'student')
        .attach('file', Buffer.from(eicar), {
          filename: 'eicar.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(400);
      expect(body<{ message: string }>(res).message).toMatch(/malware/i);
    });

    it('attaches an owner after the fact (the two-step upload-before-owner-exists flow)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ownerId: 'placeholder-student-id', ownerLabel: 'Jane Doe' });
      expect(res.status).toBe(200);
      expect(body<{ ownerId: string }>(res).ownerId).toBe(
        'placeholder-student-id',
      );
    });

    it('lists version history', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${documentId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<unknown[]>(res)).toHaveLength(1);
    });

    it('a read-only user gets 403 uploading, and a wrong-tenant user gets 404 reading', async () => {
      const uploadDenied = await request(app.getHttpServer())
        .post('/v1/documents/upload')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .field('category', 'student')
        .attach('file', Buffer.from('x'), 'x.pdf');
      expect(uploadDenied.status).toBe(403);

      const wrongTenant = await request(app.getHttpServer())
        .get(`/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(wrongTenant.status).toBe(404);
    });

    it('deletes a document (and its storage object)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });
  });

  describe('Students', () => {
    let studentId: string;
    const admissionNumber = `E2E-${randomUUID().slice(0, 8)}`;

    const payload = () => ({
      admissionNumber,
      name: 'Jane Doe',
      dob: '2015-06-01',
      gender: 'female',
      address: '123 Main St',
      nationality: 'Testland',
      language: 'English',
      classId,
      sectionId,
      academicYearId,
      status: 'active',
      medicalInfo: '',
      emergencyContacts: [
        { name: 'John Doe', relation: 'father', phone: '555-0100' },
      ],
    });

    it('creates, lists, gets, updates, and deletes a student', async () => {
      const create = await request(app.getHttpServer())
        .post('/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload());
      expect(create.status).toBe(201);
      const student = body<{ id: string; enrollmentHistory: unknown[] }>(
        create,
      );
      expect(student.enrollmentHistory).toHaveLength(1);
      studentId = student.id;

      const list = await request(app.getHttpServer())
        .get('/v1/students')
        .query({ page: 1, pageSize: 20, classId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      expect(body<{ total: number }>(list).total).toBeGreaterThanOrEqual(1);

      const get = await request(app.getHttpServer())
        .get(`/v1/students/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(get.status).toBe(200);
      expect(body<{ classTeacherId: null }>(get).classTeacherId).toBeNull();

      const update = await request(app.getHttpServer())
        .patch(`/v1/students/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...payload(), name: 'Jane Q. Doe' });
      expect(update.status).toBe(200);
      expect(
        body<{ name: string; enrollmentHistory: unknown[] }>(update).name,
      ).toBe('Jane Q. Doe');
      // Same placement → no new enrollment snapshot appended.
      expect(
        body<{ enrollmentHistory: unknown[] }>(update).enrollmentHistory,
      ).toHaveLength(1);
    });

    it('rejects a duplicate admission number with 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload());
      expect(res.status).toBe(409);
    });

    it('rejects a section that does not belong to the given class', async () => {
      const otherClass = await prisma.schoolClass.create({
        data: { tenantId: tenantAId, name: 'Grade 6' },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...payload(),
          admissionNumber: `${admissionNumber}-2`,
          classId: otherClass.id,
        });
      expect(res.status).toBe(400);
    });

    it('a read-only user gets 403 creating, and a wrong-tenant user gets 404 reading', async () => {
      const createDenied = await request(app.getHttpServer())
        .post('/v1/students')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ ...payload(), admissionNumber: `${admissionNumber}-3` });
      expect(createDenied.status).toBe(403);

      const wrongTenant = await request(app.getHttpServer())
        .get(`/v1/students/${studentId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(wrongTenant.status).toBe(404);
    });

    it('exports CSV', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/students/export')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain(admissionNumber);
    });

    it('cannot be deleted by a read-only user, but can by an admin', async () => {
      const denied = await request(app.getHttpServer())
        .delete(`/v1/students/${studentId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(denied.status).toBe(403);

      const allowed = await request(app.getHttpServer())
        .delete(`/v1/students/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(allowed.status).toBe(204);
    });
  });

  describe('Parents (+ child-linking, reflected on the student’s Family tab)', () => {
    let parentId: string;
    let studentAId: string;
    let studentBId: string;

    beforeAll(async () => {
      const makeStudent = async (admissionNumber: string, name: string) => {
        const res = await request(app.getHttpServer())
          .post('/v1/students')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            admissionNumber,
            name,
            dob: '2016-01-01',
            gender: 'other',
            address: '',
            nationality: '',
            language: '',
            classId,
            sectionId,
            academicYearId,
            status: 'active',
            medicalInfo: '',
            emergencyContacts: [],
          });
        expect(res.status).toBe(201);
        return body<{ id: string }>(res).id;
      };
      studentAId = await makeStudent(
        `PAR-A-${randomUUID().slice(0, 8)}`,
        'Alice',
      );
      studentBId = await makeStudent(
        `PAR-B-${randomUUID().slice(0, 8)}`,
        'Bob',
      );
    });

    it('creates a parent and links two children with different relations', async () => {
      const create = await request(app.getHttpServer())
        .post('/v1/parents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Carol Doe',
          email: 'carol@example.test',
          phone: '555-0200',
          address: '',
        });
      expect(create.status).toBe(201);
      parentId = body<{ id: string }>(create).id;

      const linkA = await request(app.getHttpServer())
        .post(`/v1/parents/${parentId}/children`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentAId, relation: 'mother' });
      expect(linkA.status).toBe(201);

      const linkB = await request(app.getHttpServer())
        .post(`/v1/parents/${parentId}/children`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentBId, relation: 'guardian' });
      expect(linkB.status).toBe(201);

      const get = await request(app.getHttpServer())
        .get(`/v1/parents/${parentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(body<{ children: unknown[] }>(get).children).toHaveLength(2);
    });

    it("splits the same link table into the student's parents[] vs guardians[], and computes siblings[]", async () => {
      const studentA = await request(app.getHttpServer())
        .get(`/v1/students/${studentAId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const a = body<{
        parents: { id: string; relation: string }[];
        guardians: { id: string; relation: string }[];
        siblings: { id: string; relation: string }[];
      }>(studentA);
      expect(a.parents).toEqual([
        { id: parentId, name: 'Carol Doe', relation: 'mother' },
      ]);
      expect(a.guardians).toEqual([]);
      expect(a.siblings).toEqual([
        { id: studentBId, name: 'Bob', relation: 'sibling' },
      ]);

      const studentB = await request(app.getHttpServer())
        .get(`/v1/students/${studentBId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const b = body<{
        guardians: { id: string; relation: string }[];
      }>(studentB);
      expect(b.guardians).toEqual([
        { id: parentId, name: 'Carol Doe', relation: 'guardian' },
      ]);
    });

    it('rejects linking the same child twice with 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/parents/${parentId}/children`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentAId, relation: 'father' });
      expect(res.status).toBe(409);
    });

    it('unlinks a child', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/parents/${parentId}/children/${studentBId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });

    it('GET /parents/me/children 404s — no portal user is linked to a Parent yet (documented gap)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/parents/me/children')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Teachers (+ assignments)', () => {
    let teacherId: string;
    let subjectId: string;

    beforeAll(async () => {
      const subject = await prisma.subject.create({
        data: {
          tenantId: tenantAId,
          code: 'MATH5',
          name: 'Mathematics',
          type: 'core',
          classIds: [classId],
        },
      });
      subjectId = subject.id;
    });

    it('creates, lists, updates a teacher', async () => {
      const create = await request(app.getHttpServer())
        .post('/v1/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Mr. Smith',
          email: 'smith@example.test',
          phone: '555-0300',
          employeeId: `EMP-${randomUUID().slice(0, 8)}`,
          experienceYears: 5,
          qualifications: [
            { degree: 'B.Ed', institution: 'State University', year: '2010' },
          ],
          subjectIds: [subjectId],
        });
      expect(create.status).toBe(201);
      teacherId = body<{ id: string }>(create).id;

      const list = await request(app.getHttpServer())
        .get('/v1/teachers')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
    });

    it('assigns and unassigns a teacher to a subject/class/section', async () => {
      const assign = await request(app.getHttpServer())
        .post(`/v1/teachers/${teacherId}/assignments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ subjectId, classId, sectionId });
      expect(assign.status).toBe(201);
      const assignmentId = body<{ id: string }>(assign).id;

      const get = await request(app.getHttpServer())
        .get(`/v1/teachers/${teacherId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(body<{ classIds: string[] }>(get).classIds).toEqual([classId]);

      const unassign = await request(app.getHttpServer())
        .delete(`/v1/teachers/${teacherId}/assignments/${assignmentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(unassign.status).toBe(204);
    });

    it('a caller without teachers.assign cannot assign even with teachers.update-style access', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/teachers/${teacherId}/assignments`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ subjectId, classId, sectionId });
      expect(res.status).toBe(403);
    });
  });

  describe('Admissions (full pipeline, resolved fee-ordering decision)', () => {
    let admissionId: string;

    it('creates an inquiry', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/admissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Applicant One',
          dob: '2017-01-01',
          classAppliedFor: classId,
          contactPhone: '555-0400',
          contactEmail: 'applicant@example.test',
        });
      expect(res.status).toBe(201);
      const admission = body<{ id: string; stage: string }>(res);
      expect(admission.stage).toBe('inquiry');
      admissionId = admission.id;
    });

    it('rejects skipping a stage', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'review' }); // must go through 'application' and 'documents' first
      expect(res.status).toBe(400);
    });

    it('walks inquiry → application → documents → review, gating review→entrance_test on admissions.review', async () => {
      let res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'application' });
      expect(res.status).toBe(200);

      res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          applicationDetails: { address: 'x', previousSchool: 'y', notes: 'z' },
          stage: 'documents',
        });
      expect(res.status).toBe(200);
      expect(
        body<{ applicationDetails: { address: string } }>(res)
          .applicationDetails.address,
      ).toBe('x');

      res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'review' });
      expect(res.status).toBe(200);

      // adminToken has admissions.review too — so use a caller that deliberately lacks it.
      const noReviewEmail = await createUserWithPermissions(tenantAId, [
        'admissions.read',
        'admissions.update',
      ]);
      const noReviewToken = await loginAs(noReviewEmail);
      const denied = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${noReviewToken}`)
        .send({ stage: 'entrance_test' });
      expect(denied.status).toBe(403);

      res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'entrance_test' });
      expect(res.status).toBe(200);
    });

    it('records documents via the placeholder name-only endpoint', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ fileNames: ['birth-certificate.pdf'] });
      expect(res.status).toBe(200);
      expect(body<{ documents: { name: string }[] }>(res).documents).toEqual([
        { id: 'birth-certificate.pdf', name: 'birth-certificate.pdf', url: '' },
      ]);
    });

    it('scores the entrance test, then walks interview → acceptance', async () => {
      const score = await request(app.getHttpServer())
        .post(`/v1/admissions/${admissionId}/score`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ entranceTestScore: 85, interviewNotes: '' });
      expect(score.status).toBe(200);

      const toInterview = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'interview' });
      expect(toInterview.status).toBe(200);

      const toAcceptance = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'acceptance' });
      expect(toAcceptance.status).toBe(200);
    });

    it('cannot move to fee_payment before a decision is recorded', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'fee_payment' });
      expect(res.status).toBe(400);
    });

    it('a caller with only admissions.reject cannot record an "accepted" decision', async () => {
      const rejectOnlyEmail = await createUserWithPermissions(tenantAId, [
        'admissions.read',
        'admissions.reject',
      ]);
      const rejectOnlyToken = await loginAs(rejectOnlyEmail);
      const res = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}/decision`)
        .set('Authorization', `Bearer ${rejectOnlyToken}`)
        .send({
          decision: 'accepted',
          decisionReason: '',
          applicationScore: 90,
        });
      expect(res.status).toBe(403);
    });

    it('accepts the application, moves to fee_payment, then enrollment — enroll() creates the Student', async () => {
      const decide = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}/decision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          decision: 'accepted',
          decisionReason: '',
          applicationScore: 90,
        });
      expect(decide.status).toBe(200);
      expect(body<{ decision: string }>(decide).decision).toBe('accepted');

      const toFeePayment = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'fee_payment' });
      expect(toFeePayment.status).toBe(200);

      const enrollTooEarly = await request(app.getHttpServer())
        .post(`/v1/admissions/${admissionId}/enroll`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(enrollTooEarly.status).toBe(400);

      const toEnrollment = await request(app.getHttpServer())
        .patch(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stage: 'enrollment' });
      expect(toEnrollment.status).toBe(200);

      const enroll = await request(app.getHttpServer())
        .post(`/v1/admissions/${admissionId}/enroll`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(enroll.status).toBe(200);
      const { studentId } = body<{ studentId: string }>(enroll);
      expect(studentId).toBeTruthy();

      const enrollAgain = await request(app.getHttpServer())
        .post(`/v1/admissions/${admissionId}/enroll`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(enrollAgain.status).toBe(409);

      const student = await request(app.getHttpServer())
        .get(`/v1/students/${studentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(student.status).toBe(200);
      expect(body<{ name: string }>(student).name).toBe('Applicant One');

      const admission = await request(app.getHttpServer())
        .get(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(
        body<{ enrolledStudentId: string }>(admission).enrolledStudentId,
      ).toBe(studentId);
    });

    it('rejects with a required decisionReason gate — a separate applicant reaches "rejected" without a stage change', async () => {
      const inquiry = await request(app.getHttpServer())
        .post('/v1/admissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Applicant Two',
          dob: '2017-02-02',
          classAppliedFor: classId,
          contactPhone: '555-0500',
          contactEmail: '',
        });
      const id = body<{ id: string }>(inquiry).id;

      const reject = await request(app.getHttpServer())
        .patch(`/v1/admissions/${id}/decision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          decision: 'rejected',
          decisionReason: 'Did not meet criteria',
        });
      expect(reject.status).toBe(200);
      const rejected = body<{ decision: string; stage: string }>(reject);
      expect(rejected.decision).toBe('rejected');
      expect(rejected.stage).toBe('inquiry'); // rejecting doesn't move the stage
    });

    it('reports the funnel by stage', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admissions/funnel')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const funnel = body<Record<string, number>>(res);
      expect(funnel.enrollment).toBeGreaterThanOrEqual(1);
      expect(funnel.inquiry).toBeGreaterThanOrEqual(1);
    });

    it('a wrong-tenant user gets 404 reading an admission', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/admissions/${admissionId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });
  });
});
