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

const FEES_PERMISSIONS = [
  'fees.read',
  'fees.create',
  'fees.collect',
  'fees.refund',
  'fees.delete',
];
const READ_ONLY_PERMISSIONS = ['fees.read'];
const SEARCH_PERMISSIONS = [
  'fees.read',
  'students.read',
  'admissions.read',
  'admissions.create',
];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 6 exit test: the frontend-assumed request/response shapes
 * (`frontend/src/features/fees/api.ts`, `app/layout/searchApi.ts`) hitting the real endpoints —
 * fee structures, invoice generation (single + bulk-by-class), payment recording/refund and the
 * resulting status recomputation, outstanding-balance rollups, tenant isolation, permission
 * gating, and `/search`. The admissions↔fees ordering integration itself is covered by
 * `people-documents.e2e-spec.ts`'s own "Admissions (full pipeline...)" suite, updated this phase.
 */
describe('Fees & Finance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;
  let searchToken: string;
  let noFeesSearchToken: string;

  let classId: string;
  let sectionId: string;
  let otherClassId: string;
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
    const email = `fees-e2e-${randomUUID()}@example.test`;
    const roleKey = `fees_e2e_role_${randomUUID()}`;
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
        name: 'Fees E2E Tenant A',
        slug: `fea-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Fees E2E Tenant B',
        slug: `feb-${tenantBId}`,
      },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 8', gradeLevel: 8 },
    });
    classId = schoolClass.id;
    const otherClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 9', gradeLevel: 9 },
    });
    otherClassId = otherClass.id;
    const section = await prisma.section.create({
      data: { tenantId: tenantAId, classId, name: 'A', roomLabel: 'Room 8A' },
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
    const studentA = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'A-FEES-1',
        name: 'Alice Fees',
        dob: new Date('2013-01-01'),
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
        admissionNumber: 'A-FEES-2',
        name: 'Bob Fees',
        dob: new Date('2013-02-01'),
        gender: 'male',
        classId,
        sectionId,
        academicYearId: academicYear.id,
      },
    });
    studentBId = studentB.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      FEES_PERMISSIONS,
      'Fees Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      FEES_PERMISSIONS,
    );
    const searchEmail = await createUserWithPermissions(
      tenantAId,
      SEARCH_PERMISSIONS,
    );
    const noFeesSearchEmail = await createUserWithPermissions(tenantAId, [
      'students.read',
    ]);

    adminToken = await loginAs(adminEmail);
    readOnlyToken = await loginAs(readOnlyEmail);
    tenantBToken = await loginAs(tenantBEmail);
    searchToken = await loginAs(searchEmail);
    noFeesSearchToken = await loginAs(noFeesSearchEmail);
  });

  afterAll(async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await prisma.userRole.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await app.close();
  });

  describe('Fee structures', () => {
    let structureId: string;
    let deletableStructureId: string;

    it('creates a fee structure with a discount rule', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Tuition — Grade 8',
          type: 'tuition',
          amount: 1000,
          applicableClasses: [classId],
          discountRules: [
            { label: 'Sibling discount', kind: 'percentage', value: 10 },
          ],
        });
      expect(res.status).toBe(201);
      structureId = body<{ id: string }>(res).id;
      expect(
        body<{ discountRules: unknown[] }>(res).discountRules,
      ).toHaveLength(1);
    });

    it('rejects create for a read-only caller with 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/structures')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          name: 'Should not save',
          type: 'tuition',
          amount: 100,
          applicableClasses: [classId],
          discountRules: [],
        });
      expect(res.status).toBe(403);
    });

    it('rejects an unknown class in applicableClasses', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Bad class',
          type: 'tuition',
          amount: 100,
          applicableClasses: [randomUUID()],
          discountRules: [],
        });
      expect(res.status).toBe(400);
    });

    it('gets the structure by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/fees/structures/${structureId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ name: string }>(res).name).toBe('Tuition — Grade 8');
    });

    it('404s for a wrong-tenant caller', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/fees/structures/${structureId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });

    it('lists structures, filtered by search', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/fees/structures')
        .query({ page: 1, pageSize: 20, search: 'Tuition' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(
        body<{ items: { id: string }[] }>(res).items.some(
          (s) => s.id === structureId,
        ),
      ).toBe(true);
    });

    it('updates the structure', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/fees/structures/${structureId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Tuition — Grade 8 (updated)',
          type: 'tuition',
          amount: 1200,
          applicableClasses: [classId],
          discountRules: [],
        });
      expect(res.status).toBe(200);
      expect(body<{ amount: number }>(res).amount).toBe(1200);
    });

    it('a structure with no invoices can be deleted', async () => {
      const create = await request(app.getHttpServer())
        .post('/v1/fees/structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Throwaway',
          type: 'other',
          amount: 50,
          applicableClasses: [classId],
          discountRules: [],
        });
      deletableStructureId = body<{ id: string }>(create).id;

      const res = await request(app.getHttpServer())
        .delete(`/v1/fees/structures/${deletableStructureId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });

    it('exposes the (updated) structure id to later suites', () => {
      expect(structureId).toBeTruthy();
    });
  });

  describe('Invoices + payments + outstanding', () => {
    let structureId: string;
    let studentInvoiceId: string;
    let paymentId: string;

    it('sets up a fresh tuition structure for this suite', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/structures')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Tuition — Invoicing Suite',
          type: 'tuition',
          amount: 1000,
          applicableClasses: [classId],
          discountRules: [{ label: 'Early bird', kind: 'flat', value: 100 }],
        });
      expect(res.status).toBe(201);
      structureId = body<{ id: string }>(res).id;
    });

    it('generates a single-student invoice with the discount applied', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: 'student',
          studentId: studentAId,
          feeStructureId: structureId,
          dueDate: '2027-01-15',
        });
      expect(res.status).toBe(201);
      const invoice = body<{
        id: string;
        studentId: string;
        totalAmount: number;
        paidAmount: number;
        status: string;
        studentName: string;
      }>(res);
      studentInvoiceId = invoice.id;
      expect(invoice.studentId).toBe(studentAId);
      expect(invoice.studentName).toBe('Alice Fees');
      expect(invoice.totalAmount).toBe(900); // 1000 - 100 flat discount
      expect(invoice.paidAmount).toBe(0);
      expect(invoice.status).toBe('pending');
    });

    it('rejects generating for a student not found', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: 'student',
          studentId: randomUUID(),
          feeStructureId: structureId,
          dueDate: '2027-01-15',
        });
      expect(res.status).toBe(400);
    });

    it('rejects a structure that does not apply to the target class', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: 'class',
          classId: otherClassId,
          sectionId: '',
          feeStructureId: structureId,
          dueDate: '2027-01-15',
        });
      expect(res.status).toBe(400);
    });

    it('bulk-generates one invoice per student in the class', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: 'class',
          classId,
          sectionId: '',
          feeStructureId: structureId,
          dueDate: '2027-01-15',
        });
      expect(res.status).toBe(201);
      const invoices = body<{ studentId: string }[]>(res);
      expect(invoices.length).toBeGreaterThanOrEqual(2);
      expect(invoices.some((i) => i.studentId === studentAId)).toBe(true);
      expect(invoices.some((i) => i.studentId === studentBId)).toBe(true);
    });

    it('gets the invoice by id, 404s for a wrong-tenant caller', async () => {
      const ok = await request(app.getHttpServer())
        .get(`/v1/fees/invoices/${studentInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(ok.status).toBe(200);

      const wrongTenant = await request(app.getHttpServer())
        .get(`/v1/fees/invoices/${studentInvoiceId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(wrongTenant.status).toBe(404);
    });

    it('lists invoices filtered by studentId', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/fees/invoices')
        .query({ page: 1, pageSize: 20, studentId: studentAId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const { items } = body<{ items: { studentId: string }[] }>(res);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.studentId === studentAId)).toBe(true);
    });

    it('rejects recording a payment for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/fees/invoices/${studentInvoiceId}/payments`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          invoiceId: studentInvoiceId,
          amount: 100,
          method: 'cash',
          referenceId: '',
        });
      expect(res.status).toBe(403);
    });

    it('rejects a body invoiceId that does not match the route', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/fees/invoices/${studentInvoiceId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceId: randomUUID(),
          amount: 100,
          method: 'cash',
          referenceId: '',
        });
      expect(res.status).toBe(400);
    });

    it('records a partial payment — invoice goes to "partial"', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/fees/invoices/${studentInvoiceId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceId: studentInvoiceId,
          amount: 400,
          method: 'cash',
          referenceId: 'r1',
        });
      expect(res.status).toBe(201);
      paymentId = body<{ id: string; receiptNumber: string }>(res).id;
      expect(body<{ receiptNumber: string }>(res).receiptNumber).toBeTruthy();

      const invoice = await request(app.getHttpServer())
        .get(`/v1/fees/invoices/${studentInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(body<{ status: string; paidAmount: number }>(invoice).status).toBe(
        'partial',
      );
      expect(body<{ paidAmount: number }>(invoice).paidAmount).toBe(400);
    });

    it('records the remaining payment — invoice goes to "paid"', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/fees/invoices/${studentInvoiceId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          invoiceId: studentInvoiceId,
          amount: 500,
          method: 'bank_transfer',
          referenceId: 'r2',
        });
      expect(res.status).toBe(201);

      const invoice = await request(app.getHttpServer())
        .get(`/v1/fees/invoices/${studentInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(body<{ status: string; paidAmount: number }>(invoice).status).toBe(
        'paid',
      );
      expect(body<{ paidAmount: number }>(invoice).paidAmount).toBe(900);
    });

    it('lists payments filtered by invoiceId', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/fees/payments')
        .query({ page: 1, pageSize: 20, invoiceId: studentInvoiceId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ items: unknown[] }>(res).items).toHaveLength(2);
    });

    it('gets a receipt for a payment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/fees/payments/${paymentId}/receipt`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const receipt = body<{
        payment: { id: string };
        studentName: string;
        invoice: { id: string };
      }>(res);
      expect(receipt.payment.id).toBe(paymentId);
      expect(receipt.studentName).toBe('Alice Fees');
      expect(receipt.invoice.id).toBe(studentInvoiceId);
    });

    it('rejects refund for a caller without fees.refund', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/fees/payments/${paymentId}/refund`)
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('refunds the first payment — invoice drops back to "partial"', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/fees/payments/${paymentId}/refund`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ refunded: boolean }>(res).refunded).toBe(true);

      const invoice = await request(app.getHttpServer())
        .get(`/v1/fees/invoices/${studentInvoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      // 900 total, 500 of the 900 paid still stands (the 400 payment was refunded) → partial.
      expect(body<{ status: string; paidAmount: number }>(invoice).status).toBe(
        'partial',
      );
      expect(body<{ paidAmount: number }>(invoice).paidAmount).toBe(500);
    });

    it('rejects refunding an already-refunded payment', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/fees/payments/${paymentId}/refund`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('generates an already-overdue invoice when the due date is in the past', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/fees/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          mode: 'student',
          studentId: studentBId,
          feeStructureId: structureId,
          dueDate: '2020-01-01',
        });
      expect(res.status).toBe(201);
      expect(body<{ status: string }>(res).status).toBe('overdue');
    });

    it('the fee structure now has invoices and cannot be deleted', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/fees/structures/${structureId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('rolls up outstanding balances by student', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/fees/outstanding')
        .query({ groupBy: 'student' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const summary = body<{
        totalCollected: number;
        totalOutstanding: number;
        rows: { id: string; totalOutstanding: number }[];
      }>(res);
      expect(summary.totalCollected).toBeGreaterThan(0);
      const aliceRow = summary.rows.find((r) => r.id === studentAId);
      // Alice carries two invoices from this suite: the single-student one (900 total, 500 paid
      // after the partial refund → 400 outstanding) and her share of the bulk-by-class generation
      // (900 total, unpaid → 900 outstanding) — 1300 combined.
      expect(aliceRow?.totalOutstanding).toBe(1300);
    });

    it('rolls up outstanding balances by class', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/fees/outstanding')
        .query({ groupBy: 'class' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const summary = body<{ rows: { id: string }[] }>(res);
      expect(summary.rows.some((r) => r.id === classId)).toBe(true);
    });
  });

  describe('Global search', () => {
    it('finds a student and an admission by name', async () => {
      const admission = await request(app.getHttpServer())
        .post('/v1/admissions')
        .set('Authorization', `Bearer ${searchToken}`)
        .send({
          name: 'Zzsearchable Applicant',
          dob: '2018-01-01',
          classAppliedFor: classId,
          contactPhone: '555-0900',
          contactEmail: '',
        });
      expect(admission.status).toBe(201);

      const res = await request(app.getHttpServer())
        .get('/v1/search')
        .query({ q: 'Zzsearchable' })
        .set('Authorization', `Bearer ${searchToken}`);
      expect(res.status).toBe(200);
      const results = body<{ type: string; label: string }[]>(res);
      expect(
        results.some(
          (r) => r.type === 'admission' && r.label === 'Zzsearchable Applicant',
        ),
      ).toBe(true);
    });

    it('returns nothing for a query shorter than 2 characters', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/search')
        .query({ q: 'a' })
        .set('Authorization', `Bearer ${searchToken}`);
      expect(res.status).toBe(200);
      expect(body<unknown[]>(res)).toEqual([]);
    });

    it('a caller without fees.read never sees invoice results', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/search')
        .query({ q: 'Alice Fees' })
        .set('Authorization', `Bearer ${noFeesSearchToken}`);
      expect(res.status).toBe(200);
      const results = body<{ type: string }[]>(res);
      expect(results.some((r) => r.type === 'invoice')).toBe(false);
      // Still finds the student — students.read is granted.
      expect(results.some((r) => r.type === 'student')).toBe(true);
    });

    it('finds an invoice by its student name for a caller with fees.read', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/search')
        .query({ q: 'Alice Fees', type: 'invoice' })
        .set('Authorization', `Bearer ${searchToken}`);
      expect(res.status).toBe(200);
      const results = body<{ type: string }[]>(res);
      expect(results.every((r) => r.type === 'invoice')).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
