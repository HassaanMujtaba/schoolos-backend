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

const CERTIFICATES_PERMISSIONS = ['certificates.generate', 'certificates.read'];
const READ_ONLY_PERMISSIONS = ['certificates.read'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.1 exit test: `frontend/src/features/certificates/api.ts`'s
 * assumed shapes (`generateCertificate`, `listCertificates`, `verifyCertificate`) hitting the real
 * endpoints — per-template dynamic-field validation, PDF generation + storage round trip, tenant
 * isolation, permission gating, and the public/unauthenticated verify lookup. The `documents/`
 * storage half of this module was already covered by `people-documents.e2e-spec.ts` in Phase 3 —
 * not re-tested here.
 */
describe('Certificates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;

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
    const email = `certs-e2e-${randomUUID()}@example.test`;
    const roleKey = `certs_e2e_role_${randomUUID()}`;
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
        name: 'Certs E2E Tenant A',
        slug: `cea-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Certs E2E Tenant B',
        slug: `ceb-${tenantBId}`,
      },
    });
    await prisma.school.create({
      data: { tenantId: tenantAId, name: 'Certs E2E School A' },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 6', gradeLevel: 6 },
    });
    const section = await prisma.section.create({
      data: { tenantId: tenantAId, classId: schoolClass.id, name: 'A' },
    });
    const academicYear = await prisma.academicYear.create({
      data: {
        tenantId: tenantAId,
        name: '2026-2027',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    const studentA = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'A-CERT-1',
        name: 'Alice Certs',
        dob: new Date('2014-01-01'),
        gender: 'female',
        classId: schoolClass.id,
        sectionId: section.id,
        academicYearId: academicYear.id,
      },
    });
    studentAId = studentA.id;

    const otherClass = await prisma.schoolClass.create({
      data: { tenantId: tenantBId, name: 'Grade 6', gradeLevel: 6 },
    });
    const otherSection = await prisma.section.create({
      data: { tenantId: tenantBId, classId: otherClass.id, name: 'A' },
    });
    const otherYear = await prisma.academicYear.create({
      data: {
        tenantId: tenantBId,
        name: '2026-2027',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    const studentB = await prisma.student.create({
      data: {
        tenantId: tenantBId,
        admissionNumber: 'B-CERT-1',
        name: 'Bob Certs',
        dob: new Date('2014-02-01'),
        gender: 'male',
        classId: otherClass.id,
        sectionId: otherSection.id,
        academicYearId: otherYear.id,
      },
    });
    studentBId = studentB.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      CERTIFICATES_PERMISSIONS,
      'Certs Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      CERTIFICATES_PERMISSIONS,
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

  describe('POST /certificates/generate', () => {
    it('rejects a bonafide certificate missing its required "purpose" field', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/certificates/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          template: 'bonafide',
          studentId: studentAId,
          studentLabel: 'Alice Certs (#A-CERT-1)',
          fields: {},
        });
      expect(res.status).toBe(400);
    });

    it('rejects a custom certificate with no customTitle', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/certificates/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          template: 'custom',
          studentId: studentAId,
          studentLabel: 'Alice Certs (#A-CERT-1)',
          fields: {},
        });
      expect(res.status).toBe(400);
    });

    it('rejects create for a read-only caller with 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/certificates/generate')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          template: 'bonafide',
          studentId: studentAId,
          studentLabel: 'Alice Certs (#A-CERT-1)',
          fields: { purpose: 'Visa application' },
        });
      expect(res.status).toBe(403);
    });

    it("404s generating against another tenant's student", async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/certificates/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          template: 'bonafide',
          studentId: studentBId,
          studentLabel: 'Bob Certs (#B-CERT-1)',
          fields: { purpose: 'Visa application' },
        });
      expect(res.status).toBe(404);
    });

    let certificateId: string;
    let verifyCode: string;
    let certificateNumber: string;

    it('generates a bonafide certificate — real PDF, QR code, unique number', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/certificates/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          template: 'bonafide',
          studentId: studentAId,
          studentLabel: 'Alice Certs (#A-CERT-1)',
          fields: { purpose: 'Visa application' },
        });
      expect(res.status).toBe(201);
      const cert = body<{
        id: string;
        certificateNumber: string;
        template: string;
        title: string;
        studentId: string;
        studentLabel: string;
        fields: Record<string, string>;
        pdfUrl: string;
        verifyCode: string;
      }>(res);
      expect(cert.template).toBe('bonafide');
      expect(cert.title).toBe('Bonafide certificate');
      expect(cert.studentId).toBe(studentAId);
      expect(cert.studentLabel).toContain('Alice Certs');
      expect(cert.fields).toEqual({ purpose: 'Visa application' });
      expect(cert.pdfUrl).toMatch(/^http/);
      expect(cert.verifyCode).toBeTruthy();
      expect(cert.certificateNumber).toMatch(/^CERT/);
      certificateId = cert.id;
      verifyCode = cert.verifyCode;
      certificateNumber = cert.certificateNumber;

      // The signed PDF URL is real and actually serves generated bytes — a real PDF (magic
      // bytes), not just a well-formed URL string. Same "not just well-formed, actually works"
      // discipline `people-documents.e2e-spec.ts`'s upload round-trip test already established.
      const download = await fetch(cert.pdfUrl);
      expect(download.status).toBe(200);
      const bytes = Buffer.from(await download.arrayBuffer());
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
    });

    it('generates a custom certificate with a caller-provided title and no dynamic fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/certificates/generate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          template: 'custom',
          studentId: studentAId,
          studentLabel: 'Alice Certs (#A-CERT-1)',
          customTitle: 'Sports Day Participation',
          fields: {},
        });
      expect(res.status).toBe(201);
      expect(
        body<{ title: string; fields: Record<string, string> }>(res).title,
      ).toBe('Sports Day Participation');
      expect(
        body<{ title: string; fields: Record<string, string> }>(res).fields,
      ).toEqual({});
    });

    describe('GET /certificates', () => {
      it('lists certificates, filterable by studentId', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/certificates')
          .query({ studentId: studentAId, page: 1, pageSize: 20 })
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        const list = body<{ items: { id: string }[]; total: number }>(res);
        expect(list.total).toBeGreaterThanOrEqual(2);
        expect(list.items.some((c) => c.id === certificateId)).toBe(true);
      });

      it("a wrong-tenant caller sees none of tenant A's certificates", async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/certificates')
          .set('Authorization', `Bearer ${tenantBToken}`);
        expect(res.status).toBe(200);
        expect(
          body<{ items: { id: string }[] }>(res).items.some(
            (c) => c.id === certificateId,
          ),
        ).toBe(false);
      });
    });

    describe('GET /certificates/verify/:code (public, unauthenticated)', () => {
      it('verifies a real code with no Authorization header at all', async () => {
        const res = await request(app.getHttpServer()).get(
          `/v1/certificates/verify/${verifyCode}`,
        );
        expect(res.status).toBe(200);
        const result = body<{
          valid: boolean;
          certificateNumber: string;
          template: string;
          studentLabel: string;
          schoolName: string;
        }>(res);
        expect(result.valid).toBe(true);
        expect(result.certificateNumber).toBe(certificateNumber);
        expect(result.template).toBe('bonafide');
        expect(result.studentLabel).toContain('Alice Certs');
        expect(result.schoolName).toBe('Certs E2E School A');
      });

      it('404s an unknown code', async () => {
        const res = await request(app.getHttpServer()).get(
          '/v1/certificates/verify/not-a-real-code',
        );
        expect(res.status).toBe(404);
      });
    });
  });
});
