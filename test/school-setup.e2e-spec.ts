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

const SCHOOL_SETUP_PERMISSIONS = [
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
];
const READ_ONLY_PERMISSIONS = SCHOOL_SETUP_PERMISSIONS.filter((p) =>
  p.endsWith('.read'),
);

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 2 exit test: the frontend-assumed request/response shapes
 * (`frontend/src/features/school-setup/api.ts`) hitting the real endpoints, plus tenant isolation
 * and permission gating (this is the first phase to actually exercise
 * `PrismaService`'s tenant-scoped create/update/delete path against a live database, not just
 * Phase 1's auth surface).
 */
describe('School Setup (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;

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
    const email = `school-setup-e2e-${randomUUID()}@example.test`;
    const roleKey = `school_setup_e2e_role_${randomUUID()}`;
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
        name: 'School Setup E2E Tenant A',
        slug: `ssa-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'School Setup E2E Tenant B',
        slug: `ssb-${tenantBId}`,
      },
    });

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      SCHOOL_SETUP_PERMISSIONS,
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      SCHOOL_SETUP_PERMISSIONS,
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

  describe('School profile', () => {
    it('GET /schools/current lazily creates a school row defaulted from the tenant name', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/schools/current')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const school = body<{ id: string; name: string; schoolType: string }>(
        res,
      );
      expect(school.name).toBe('School Setup E2E Tenant A');
      expect(school.schoolType).toBe('other');
    });

    it('PATCH /schools/current updates the profile, and rejects an invalid email/URL', async () => {
      const valid = {
        name: 'Updated School Name',
        email: 'admin@school.example',
        phone: '+1 555 0100',
        website: 'https://school.example',
        address: '123 Main St',
        registrationNumber: 'REG-1',
        taxInfo: 'TAX-1',
        schoolType: 'higher-secondary',
        timezone: 'UTC',
        currency: 'USD',
        language: 'en',
        logoUrl: '',
      };

      const ok = await request(app.getHttpServer())
        .patch('/v1/schools/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(valid);
      expect(ok.status).toBe(200);
      expect(body<{ name: string; schoolType: string }>(ok)).toMatchObject({
        name: 'Updated School Name',
        schoolType: 'higher-secondary',
      });

      const invalid = await request(app.getHttpServer())
        .patch('/v1/schools/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...valid, email: 'not-an-email' });
      expect(invalid.status).toBe(400);
    });

    it('a read-only user gets 403 on PATCH /schools/current', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/schools/current')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          name: 'x',
          email: '',
          phone: '',
          website: '',
          address: '',
          registrationNumber: '',
          taxInfo: '',
          schoolType: 'other',
          timezone: 'UTC',
          currency: 'USD',
          language: 'en',
          logoUrl: '',
        });
      expect(res.status).toBe(403);
    });
  });

  describe('Branches (+ nested buildings/departments)', () => {
    it('creates, lists (with search), gets, updates (replacing children), and deletes a branch', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/v1/branches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Main Campus',
          campus: 'North',
          address: '1 School Rd',
          buildings: [{ name: 'Block A' }, { name: 'Block B' }],
          departments: [{ name: 'Science' }],
        });
      expect(createRes.status).toBe(201);
      const branch = body<{
        id: string;
        buildings: { id: string; name: string }[];
        departments: { id: string; name: string }[];
      }>(createRes);
      expect(branch.buildings).toHaveLength(2);
      expect(branch.departments).toHaveLength(1);

      const listRes = await request(app.getHttpServer())
        .get('/v1/branches')
        .query({ page: 1, pageSize: 20, search: 'Main' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      const list = body<{ items: { id: string }[]; total: number }>(listRes);
      expect(list.items.some((b) => b.id === branch.id)).toBe(true);

      const getRes = await request(app.getHttpServer())
        .get(`/v1/branches/${branch.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.status).toBe(200);

      const updateRes = await request(app.getHttpServer())
        .patch(`/v1/branches/${branch.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Main Campus Renamed',
          campus: 'North',
          address: '1 School Rd',
          buildings: [{ name: 'Block C' }],
          departments: [],
        });
      expect(updateRes.status).toBe(200);
      const updated = body<{
        name: string;
        buildings: { name: string }[];
        departments: unknown[];
      }>(updateRes);
      expect(updated.name).toBe('Main Campus Renamed');
      expect(updated.buildings).toHaveLength(1);
      expect(updated.buildings[0]).toMatchObject({ name: 'Block C' });
      expect(updated.departments).toEqual([]);

      const deleteRes = await request(app.getHttpServer())
        .delete(`/v1/branches/${branch.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteRes.status).toBe(204);

      const afterDelete = await request(app.getHttpServer())
        .get(`/v1/branches/${branch.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(afterDelete.status).toBe(404);
    });

    it('a read-only user gets 403 creating a branch, and a wrong-tenant user gets 404 reading one', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/v1/branches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Isolation Test Branch',
          campus: '',
          address: '',
          buildings: [],
          departments: [],
        });
      expect(createRes.status).toBe(201);
      const branch = body<{ id: string }>(createRes);

      const forbidden = await request(app.getHttpServer())
        .post('/v1/branches')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          name: 'Nope',
          campus: '',
          address: '',
          buildings: [],
          departments: [],
        });
      expect(forbidden.status).toBe(403);

      const crossTenant = await request(app.getHttpServer())
        .get(`/v1/branches/${branch.id}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(crossTenant.status).toBe(404);
    });
  });

  describe('Academic years (+ nested terms/holidays)', () => {
    it('creates with terms/holidays, computes isCurrent, and rejects an inverted date range', async () => {
      const past = await request(app.getHttpServer())
        .post('/v1/academic-years')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Past Year',
          startDate: '2020-01-01',
          endDate: '2020-12-31',
          terms: [
            { name: 'Term 1', startDate: '2020-01-01', endDate: '2020-06-30' },
          ],
          holidays: [{ name: 'New Year', date: '2020-01-01' }],
        });
      expect(past.status).toBe(201);
      expect(body<{ isCurrent: boolean }>(past).isCurrent).toBe(false);

      const currentYear = new Date().getUTCFullYear();
      const current = await request(app.getHttpServer())
        .post('/v1/academic-years')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Current Year',
          startDate: `${currentYear}-01-01`,
          endDate: `${currentYear}-12-31`,
          terms: [],
          holidays: [],
        });
      expect(current.status).toBe(201);
      expect(body<{ isCurrent: boolean }>(current).isCurrent).toBe(true);

      const invalid = await request(app.getHttpServer())
        .post('/v1/academic-years')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Broken Year',
          startDate: '2026-06-30',
          endDate: '2026-01-01',
          terms: [],
          holidays: [],
        });
      expect(invalid.status).toBe(400);
    });
  });

  describe('Classes → Sections → Subjects (referential checks)', () => {
    it('a section must reference a real class in the same tenant', async () => {
      const classRes = await request(app.getHttpServer())
        .post('/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Grade 5', gradeLevel: 5 });
      expect(classRes.status).toBe(201);
      const schoolClass = body<{ id: string }>(classRes);

      const badSection = await request(app.getHttpServer())
        .post('/v1/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A',
          classId: randomUUID(),
          classTeacherName: '',
          roomLabel: '',
        });
      expect(badSection.status).toBe(400);

      const goodSection = await request(app.getHttpServer())
        .post('/v1/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A',
          classId: schoolClass.id,
          classTeacherName: 'Ms. Lee',
          roomLabel: 'Room 5A',
        });
      expect(goodSection.status).toBe(201);

      const filtered = await request(app.getHttpServer())
        .get('/v1/sections')
        .query({ page: 1, pageSize: 20, classId: schoolClass.id })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(filtered.status).toBe(200);
      const filteredList = body<{ items: { classId: string }[] }>(filtered);
      expect(
        filteredList.items.every((s) => s.classId === schoolClass.id),
      ).toBe(true);
      expect(filteredList.items.length).toBeGreaterThan(0);

      // A class from tenant A is invisible to tenant B — the "class doesn't exist" 400 must fire
      // even though the id is real, for the *wrong tenant*.
      const crossTenantSection = await request(app.getHttpServer())
        .post('/v1/sections')
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({
          name: 'A',
          classId: schoolClass.id,
          classTeacherName: '',
          roomLabel: '',
        });
      expect(crossTenantSection.status).toBe(400);
    });

    it('a subject validates every id in classIds, not just the first', async () => {
      const classRes = await request(app.getHttpServer())
        .post('/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Grade 6' });
      const schoolClass = body<{ id: string }>(classRes);

      const badSubject = await request(app.getHttpServer())
        .post('/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'MATH6',
          name: 'Mathematics',
          type: 'core',
          classIds: [schoolClass.id, randomUUID()],
        });
      expect(badSubject.status).toBe(400);

      const goodSubject = await request(app.getHttpServer())
        .post('/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'MATH6',
          name: 'Mathematics',
          type: 'core',
          classIds: [schoolClass.id],
        });
      expect(goodSubject.status).toBe(201);
      expect(body<{ classIds: string[] }>(goodSubject).classIds).toEqual([
        schoolClass.id,
      ]);
    });

    it('deleting a class cascades to its sections (relational integrity, not a soft check)', async () => {
      const classRes = await request(app.getHttpServer())
        .post('/v1/classes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Grade 7 (to delete)' });
      const schoolClass = body<{ id: string }>(classRes);

      await request(app.getHttpServer())
        .post('/v1/sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A',
          classId: schoolClass.id,
          classTeacherName: '',
          roomLabel: '',
        });

      const deleteRes = await request(app.getHttpServer())
        .delete(`/v1/classes/${schoolClass.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteRes.status).toBe(204);

      const sectionsAfter = await request(app.getHttpServer())
        .get('/v1/sections')
        .query({ page: 1, pageSize: 20, classId: schoolClass.id })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(body<{ items: unknown[] }>(sectionsAfter).items).toEqual([]);
    });
  });
});
