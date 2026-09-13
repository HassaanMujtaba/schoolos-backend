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

const LIBRARY_PERMISSIONS = [
  'library.read',
  'library.manage-catalog',
  'library.circulate',
];
const READ_ONLY_PERMISSIONS = ['library.read'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.2 exit test: `frontend/src/features/library/api.ts`'s
 * assumed shapes hitting the real endpoints — catalog CRUD, issue/return with server-computed due
 * dates and fines, the reservation FIFO queue + fulfillment, the settings singleton, tenant
 * isolation and permission gating, and the portal's self-service reservation/loan reads.
 */
describe('Library (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;
  let studentToken: string;

  let studentAId: string;

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
    const email = `library-e2e-${randomUUID()}@example.test`;
    const roleKey = `library_e2e_role_${randomUUID()}`;
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
        name: 'Library E2E Tenant A',
        slug: `lea-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Library E2E Tenant B',
        slug: `leb-${tenantBId}`,
      },
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
        admissionNumber: 'A-LIB-1',
        name: 'Lina Library',
        dob: new Date('2014-01-01'),
        gender: 'female',
        classId: schoolClass.id,
        sectionId: section.id,
        academicYearId: academicYear.id,
      },
    });
    studentAId = studentA.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      LIBRARY_PERMISSIONS,
      'Lib Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      LIBRARY_PERMISSIONS,
    );
    const studentEmail = await createUserWithPermissions(
      tenantAId,
      [],
      'Lina Library Portal',
    );
    const studentUser = await prisma.user.findFirstOrThrow({
      where: { email: studentEmail },
    });
    await prisma.student.update({
      where: { id: studentAId },
      data: { userId: studentUser.id },
    });

    adminToken = await loginAs(adminEmail);
    readOnlyToken = await loginAs(readOnlyEmail);
    tenantBToken = await loginAs(tenantBEmail);
    studentToken = await loginAs(studentEmail);
  });

  afterAll(async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await prisma.userRole.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await app.close();
  });

  let categoryId: string;
  let shelfId: string;
  let bookId: string;
  let copy1Id: string;
  let copy1Barcode: string;
  let copy2Id: string;
  let copy2Barcode: string;
  let memberId: string;

  describe('Catalog', () => {
    it('403s creating a category for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/categories')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ name: 'Fiction' });
      expect(res.status).toBe(403);
    });

    it('creates a category and a shelf', async () => {
      const category = await request(app.getHttpServer())
        .post('/v1/library/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Fiction' });
      expect(category.status).toBe(201);
      categoryId = body<{ id: string }>(category).id;

      const shelf = await request(app.getHttpServer())
        .post('/v1/library/shelves')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'A1' });
      expect(shelf.status).toBe(201);
      shelfId = body<{ id: string }>(shelf).id;
    });

    it('creates a book with zero copies', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/books')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'The Great Adventure',
          isbn: '978-0-00-000000-0',
          author: 'A. Writer',
          publisher: 'Pub House',
          categoryId,
          shelfId,
          edition: '1st',
          description: 'A book.',
        });
      expect(res.status).toBe(201);
      const book = body<{
        id: string;
        totalCopies: number;
        availableCopies: number;
      }>(res);
      expect(book.totalCopies).toBe(0);
      expect(book.availableCopies).toBe(0);
      bookId = book.id;
    });

    it('adds two copies, reflected in the book totals', async () => {
      copy1Barcode = `BC-${randomUUID()}`;
      copy2Barcode = `BC-${randomUUID()}`;
      const copy1 = await request(app.getHttpServer())
        .post(`/v1/library/books/${bookId}/copies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ barcode: copy1Barcode });
      expect(copy1.status).toBe(201);
      copy1Id = body<{ id: string }>(copy1).id;

      const copy2 = await request(app.getHttpServer())
        .post(`/v1/library/books/${bookId}/copies`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ barcode: copy2Barcode });
      expect(copy2.status).toBe(201);
      copy2Id = body<{ id: string }>(copy2).id;

      const book = await request(app.getHttpServer())
        .get(`/v1/library/books/${bookId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(
        body<{ totalCopies: number; availableCopies: number }>(book)
          .totalCopies,
      ).toBe(2);
      expect(
        body<{ totalCopies: number; availableCopies: number }>(book)
          .availableCopies,
      ).toBe(2);
    });

    it("404s another tenant's book lookup and excludes it from that tenant's list", async () => {
      const get = await request(app.getHttpServer())
        .get(`/v1/library/books/${bookId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(get.status).toBe(404);

      const list = await request(app.getHttpServer())
        .get('/v1/library/books')
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(list.status).toBe(200);
      expect(
        body<{ items: { id: string }[] }>(list).items.some(
          (b) => b.id === bookId,
        ),
      ).toBe(false);
    });

    it('refuses to remove a copy that is not available and a book that still has copies', async () => {
      // (covered further down once a copy is actually on loan)
      const res = await request(app.getHttpServer())
        .delete(`/v1/library/books/${bookId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });
  });

  describe('Members', () => {
    it('creates a student member', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/members')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          memberType: 'student',
          personId: studentAId,
          personLabel: 'Lina Library (#A-LIB-1)',
          maxBooks: 2,
          loanPeriodDays: 14,
        });
      expect(res.status).toBe(201);
      const member = body<{
        id: string;
        activeLoans: number;
        outstandingFines: number;
      }>(res);
      expect(member.activeLoans).toBe(0);
      expect(member.outstandingFines).toBe(0);
      memberId = member.id;
    });

    it('400s a member for a person that does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/members')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          memberType: 'student',
          personId: randomUUID(),
          personLabel: 'Ghost',
          maxBooks: 2,
          loanPeriodDays: 14,
        });
      expect(res.status).toBe(400);
    });
  });

  describe('Settings', () => {
    it('defaults to a zero fine rate, then updates', async () => {
      const initial = await request(app.getHttpServer())
        .get('/v1/library/settings')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(initial.status).toBe(200);
      expect(
        body<{ finePerDayRate: number; maxFine: number | null }>(initial)
          .finePerDayRate,
      ).toBe(0);

      const updated = await request(app.getHttpServer())
        .patch('/v1/library/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ finePerDayRate: 10, maxFine: 100 });
      expect(updated.status).toBe(200);
      expect(
        body<{ finePerDayRate: number; maxFine: number | null }>(updated),
      ).toEqual({
        finePerDayRate: 10,
        maxFine: 100,
      });
    });
  });

  describe('Circulation', () => {
    let loan1Id: string;

    it('looks up an available copy with no active loan or reservation', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/library/copies/lookup')
        .query({ barcode: copy1Barcode })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const lookup = body<{
        copy: { status: string };
        activeLoan: unknown;
        nextReservation: unknown;
      }>(res);
      expect(lookup.copy.status).toBe('available');
      expect(lookup.activeLoan).toBeNull();
      expect(lookup.nextReservation).toBeNull();
    });

    it('issues a copy, computing a server-side due date', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/issue')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ copyId: copy1Id, memberId });
      expect(res.status).toBe(201);
      const loan = body<{
        id: string;
        issuedAt: string;
        dueAt: string;
        memberLabel: string;
      }>(res);
      expect(loan.memberLabel).toBe('Lina Library (#A-LIB-1)');
      const issued = new Date(`${loan.issuedAt}T00:00:00Z`);
      const due = new Date(`${loan.dueAt}T00:00:00Z`);
      expect(Math.round((due.getTime() - issued.getTime()) / 86_400_000)).toBe(
        14,
      );
      loan1Id = loan.id;
    });

    it('409s issuing the same copy again while on loan', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/issue')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ copyId: copy1Id, memberId });
      expect(res.status).toBe(409);
    });

    it('refuses to remove an issued copy', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/library/books/${bookId}/copies/${copy1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('returns the copy same-day with no fine', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/return')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ loanId: loan1Id, condition: 'ok' });
      expect(res.status).toBe(201);
      const loan = body<{
        fineAmount: number;
        fineStatus: string;
        returnedAt: string | null;
      }>(res);
      expect(loan.fineAmount).toBe(0);
      expect(loan.fineStatus).toBe('none');
      expect(loan.returnedAt).not.toBeNull();

      const lookup = await request(app.getHttpServer())
        .get('/v1/library/copies/lookup')
        .query({ barcode: copy1Barcode })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(body<{ copy: { status: string } }>(lookup).copy.status).toBe(
        'available',
      );
    });

    it('computes a real fine for an overdue return, then pays it', async () => {
      const issue = await request(app.getHttpServer())
        .post('/v1/library/issue')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ copyId: copy1Id, memberId });
      expect(issue.status).toBe(201);
      const loan = body<{ id: string }>(issue);

      // Backdate the due date directly — the only way to exercise "overdue" without waiting real
      // days, same trick a scheduler-dependent test elsewhere in this suite would need too.
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setUTCDate(fiveDaysAgo.getUTCDate() - 5);
      await prisma.loan.update({
        where: { id: loan.id },
        data: { dueAt: fiveDaysAgo },
      });

      const ret = await request(app.getHttpServer())
        .post('/v1/library/return')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ loanId: loan.id, condition: 'ok' });
      expect(ret.status).toBe(201);
      const returned = body<{ fineAmount: number; fineStatus: string }>(ret);
      expect(returned.fineAmount).toBe(50); // 5 days * 10/day, under the 100 cap
      expect(returned.fineStatus).toBe('pending');

      const fines = await request(app.getHttpServer())
        .get('/v1/library/fines')
        .query({ memberId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(fines.status).toBe(200);
      expect(
        body<{ items: { id: string }[] }>(fines).items.some(
          (f) => f.id === loan.id,
        ),
      ).toBe(true);

      const pay = await request(app.getHttpServer())
        .post(`/v1/library/fines/${loan.id}/pay`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(pay.status).toBe(200);
      expect(body<{ fineStatus: string }>(pay).fineStatus).toBe('paid');

      const payAgain = await request(app.getHttpServer())
        .post(`/v1/library/fines/${loan.id}/pay`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(payAgain.status).toBe(409);
    });
  });

  describe('Reservations', () => {
    let reservationId: string;

    it('issues the remaining copy so the book has none available', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/issue')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ copyId: copy2Id, memberId });
      expect(res.status).toBe(201);
    });

    it('403s a portal caller reserving with a librarian-only memberId', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/reservations')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ bookId, memberId });
      expect(res.status).toBe(403);
    });

    it('creates a self-service reservation for the student, auto-provisioning their membership', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/library/reservations')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ bookId, studentId: 'me' });
      expect(res.status).toBe(201);
      const reservation = body<{
        id: string;
        queuePosition: number;
        memberLabel: string;
      }>(res);
      expect(reservation.queuePosition).toBe(1);
      expect(reservation.memberLabel).toContain('Lina Library');
      reservationId = reservation.id;
    });

    it("shows the reservation in the student's own portal list", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/library/reservations')
        .query({ studentId: 'me' })
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(200);
      expect(
        body<{ items: { id: string }[] }>(res).items.some(
          (r) => r.id === reservationId,
        ),
      ).toBe(true);
    });

    it("surfaces the reservation as the copy's nextReservation once a copy is returned", async () => {
      const loans = await prisma.loan.findMany({
        where: { copyId: copy2Id, returnedAt: null },
      });
      const returnRes = await request(app.getHttpServer())
        .post('/v1/library/return')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ loanId: loans[0].id, condition: 'ok' });
      expect(returnRes.status).toBe(201);

      const lookup = await request(app.getHttpServer())
        .get('/v1/library/copies/lookup')
        .query({ barcode: copy2Barcode })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(lookup.status).toBe(200);
      const data = body<{
        nextReservation: { id: string; queuePosition: number } | null;
      }>(lookup);
      expect(data.nextReservation?.id).toBe(reservationId);
      expect(data.nextReservation?.queuePosition).toBe(1);
    });

    it('fulfills the reservation atomically — issues the copy and marks it fulfilled', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/library/reservations/${reservationId}/fulfill`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ copyId: copy2Id });
      expect(res.status).toBe(201);
      const loan = body<{ copyId: string; memberLabel: string }>(res);
      expect(loan.copyId).toBe(copy2Id);
      expect(loan.memberLabel).toContain('Lina Library');

      const list = await request(app.getHttpServer())
        .get('/v1/library/reservations')
        .query({ bookId })
        .set('Authorization', `Bearer ${adminToken}`);
      const fulfilled = body<{ items: { id: string; status: string }[] }>(
        list,
      ).items.find((r) => r.id === reservationId);
      expect(fulfilled?.status).toBe('fulfilled');

      // The student now has a real loan — the portal loans read should surface it.
      const portalLoans = await request(app.getHttpServer())
        .get('/v1/library/loans')
        .query({ studentId: 'me' })
        .set('Authorization', `Bearer ${studentToken}`);
      expect(portalLoans.status).toBe(200);
      expect(
        body<{ copyId: string }[]>(portalLoans).some(
          (l) => l.copyId === copy2Id,
        ),
      ).toBe(true);
    });

    it('lets the student cancel their own pending reservation', async () => {
      const create = await request(app.getHttpServer())
        .post('/v1/library/reservations')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ bookId, studentId: 'me' });
      expect(create.status).toBe(201);
      const reservation = body<{ id: string }>(create);

      const cancel = await request(app.getHttpServer())
        .post(`/v1/library/reservations/${reservation.id}/cancel`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(cancel.status).toBe(200);

      const cancelAgain = await request(app.getHttpServer())
        .post(`/v1/library/reservations/${reservation.id}/cancel`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(cancelAgain.status).toBe(409);
    });
  });
});
