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

const TRANSPORT_PERMISSIONS = ['transport.read', 'transport.manage'];
const READ_ONLY_PERMISSIONS = ['transport.read'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.3 exit test: `frontend/src/features/transport/api.ts`'s
 * assumed shapes hitting the real endpoints — vehicle CRUD with wholesale-replaced maintenance
 * records, route CRUD with wholesale-replaced stops and studentIds/feeStructureId referential
 * checks, the vehicle-delete-blocked-while-routes-reference-it guard, and tenant/permission
 * isolation for both resources.
 */
describe('Transport (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;

  let studentAId: string;
  let feeStructureId: string;

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
    const email = `transport-e2e-${randomUUID()}@example.test`;
    const roleKey = `transport_e2e_role_${randomUUID()}`;
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
        name: 'Transport E2E Tenant A',
        slug: `tea-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Transport E2E Tenant B',
        slug: `teb-${tenantBId}`,
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
        admissionNumber: 'A-TRN-1',
        name: 'Tina Transport',
        dob: new Date('2014-01-01'),
        gender: 'female',
        classId: schoolClass.id,
        sectionId: section.id,
        academicYearId: academicYear.id,
      },
    });
    studentAId = studentA.id;

    const feeStructure = await prisma.feeStructure.create({
      data: {
        tenantId: tenantAId,
        name: 'Bus Fee',
        type: 'transport',
        amount: 500,
        applicableClasses: [],
      },
    });
    feeStructureId = feeStructure.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      TRANSPORT_PERMISSIONS,
      'Transport Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      TRANSPORT_PERMISSIONS,
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

  let vehicleId: string;
  let secondVehicleId: string;
  let routeId: string;

  const vehiclePayload = {
    registrationNumber: 'BUS-001',
    type: 'bus',
    capacity: 40,
    status: 'active',
    driverName: 'Sam Driver',
    driverPhone: '+1-555-0100',
    insuranceProvider: 'SafeInsure',
    insuranceExpiryDate: '2027-06-30',
    maintenanceRecords: [
      { date: '2026-01-15', description: 'Oil change', cost: 80 },
    ],
  };

  describe('Vehicles', () => {
    it('403s creating a vehicle for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/vehicles')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send(vehiclePayload);
      expect(res.status).toBe(403);
    });

    it('400s an invalid capacity', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...vehiclePayload, capacity: 0 });
      expect(res.status).toBe(400);
    });

    it('creates a vehicle with a nested maintenance record', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(vehiclePayload);
      expect(res.status).toBe(201);
      const vehicle = body<{
        id: string;
        registrationNumber: string;
        insuranceExpiryDate: string;
        maintenanceRecords: {
          date: string;
          description: string;
          cost: number;
        }[];
        documents: unknown[];
      }>(res);
      expect(vehicle.registrationNumber).toBe('BUS-001');
      expect(vehicle.insuranceExpiryDate).toBe('2027-06-30');
      expect(vehicle.maintenanceRecords).toHaveLength(1);
      expect(vehicle.maintenanceRecords[0].description).toBe('Oil change');
      expect(vehicle.documents).toEqual([]);
      vehicleId = vehicle.id;
    });

    it('creates a second vehicle with no insurance expiry date and no maintenance records', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/vehicles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...vehiclePayload,
          registrationNumber: 'VAN-002',
          type: 'van',
          capacity: 12,
          insuranceExpiryDate: '',
          maintenanceRecords: [],
        });
      expect(res.status).toBe(201);
      const vehicle = body<{ id: string; insuranceExpiryDate: string }>(res);
      expect(vehicle.insuranceExpiryDate).toBe('');
      secondVehicleId = vehicle.id;
    });

    it('lists vehicles including the created one', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/transport/vehicles')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[]; total: number }>(res);
      expect(page.items.some((v) => v.id === vehicleId)).toBe(true);
    });

    it('gets a vehicle by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/transport/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }>(res).id).toBe(vehicleId);
    });

    it('404s a cross-tenant vehicle get', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/transport/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });

    it('replaces maintenance records wholesale on update', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/transport/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...vehiclePayload,
          maintenanceRecords: [
            { date: '2026-03-01', description: 'Tire replacement', cost: 200 },
            { date: '2026-04-01', description: 'Brake check' },
          ],
        });
      expect(res.status).toBe(200);
      const vehicle = body<{
        maintenanceRecords: { description: string; cost?: number }[];
      }>(res);
      expect(vehicle.maintenanceRecords).toHaveLength(2);
      expect(
        vehicle.maintenanceRecords.map((m) => m.description).sort(),
      ).toEqual(['Brake check', 'Tire replacement'].sort());
    });

    it('403s updating a vehicle for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/transport/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send(vehiclePayload);
      expect(res.status).toBe(403);
    });

    it('409s deleting a vehicle still assigned to a route', async () => {
      const routeRes = await request(app.getHttpServer())
        .post('/v1/transport/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Blocking Route',
          vehicleId,
          driverName: '',
          attendantName: '',
          feeStructureId: '',
          stops: [],
          studentIds: [],
        });
      expect(routeRes.status).toBe(201);
      const blockingRouteId = body<{ id: string }>(routeRes).id;

      const del = await request(app.getHttpServer())
        .delete(`/v1/transport/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(409);

      const cleanup = await request(app.getHttpServer())
        .delete(`/v1/transport/routes/${blockingRouteId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(cleanup.status).toBe(204);
    });

    it('deletes a vehicle once nothing references it', async () => {
      const del = await request(app.getHttpServer())
        .delete(`/v1/transport/vehicles/${secondVehicleId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(204);

      const get = await request(app.getHttpServer())
        .get(`/v1/transport/vehicles/${secondVehicleId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(get.status).toBe(404);
    });
  });

  describe('Routes', () => {
    it('403s creating a route for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/routes')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          name: 'Route 1',
          vehicleId,
          driverName: '',
          attendantName: '',
          feeStructureId: '',
          stops: [],
          studentIds: [],
        });
      expect(res.status).toBe(403);
    });

    it('400s a nonexistent vehicleId', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Route 1',
          vehicleId: randomUUID(),
          driverName: '',
          attendantName: '',
          feeStructureId: '',
          stops: [],
          studentIds: [],
        });
      expect(res.status).toBe(400);
    });

    it('400s a nonexistent studentId', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Route 1',
          vehicleId,
          driverName: '',
          attendantName: '',
          feeStructureId: '',
          stops: [],
          studentIds: [randomUUID()],
        });
      expect(res.status).toBe(400);
    });

    it('400s a nonexistent feeStructureId', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Route 1',
          vehicleId,
          driverName: '',
          attendantName: '',
          feeStructureId: randomUUID(),
          stops: [],
          studentIds: [],
        });
      expect(res.status).toBe(400);
    });

    it('400s a cross-tenant vehicleId (invisible, so treated as not found)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/routes')
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({
          name: 'Cross-tenant route',
          vehicleId,
          driverName: '',
          attendantName: '',
          feeStructureId: '',
          stops: [],
          studentIds: [],
        });
      expect(res.status).toBe(400);
    });

    it('creates a route with stops, a fee-structure link, and an assigned student', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/transport/routes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Morning Route',
          vehicleId,
          driverName: 'Sam Driver',
          attendantName: 'Ann Attendant',
          feeStructureId,
          stops: [
            { name: 'Main Street', time: '07:00' },
            { name: 'Oak Avenue', time: '07:15' },
          ],
          studentIds: [studentAId],
        });
      expect(res.status).toBe(201);
      const route = body<{
        id: string;
        feeStructureId: string;
        stops: { name: string; time: string }[];
        studentIds: string[];
      }>(res);
      expect(route.feeStructureId).toBe(feeStructureId);
      expect(route.stops.map((s) => s.name)).toEqual([
        'Main Street',
        'Oak Avenue',
      ]);
      expect(route.studentIds).toEqual([studentAId]);
      routeId = route.id;
    });

    it('lists routes including the created one', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/transport/routes')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((r) => r.id === routeId)).toBe(true);
    });

    it('404s a cross-tenant route get', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/transport/routes/${routeId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });

    it('replaces stops wholesale and clears the fee-structure link on update', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/transport/routes/${routeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Morning Route',
          vehicleId,
          driverName: 'Sam Driver',
          attendantName: 'Ann Attendant',
          feeStructureId: '',
          stops: [{ name: 'New Stop', time: '07:30' }],
          studentIds: [],
        });
      expect(res.status).toBe(200);
      const route = body<{
        feeStructureId: string;
        stops: { name: string }[];
        studentIds: string[];
      }>(res);
      expect(route.feeStructureId).toBe('');
      expect(route.stops.map((s) => s.name)).toEqual(['New Stop']);
      expect(route.studentIds).toEqual([]);
    });

    it('403s deleting a route for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/transport/routes/${routeId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('deletes the route', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/transport/routes/${routeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);

      const get = await request(app.getHttpServer())
        .get(`/v1/transport/routes/${routeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(get.status).toBe(404);
    });
  });
});
