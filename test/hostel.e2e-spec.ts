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

const HOSTEL_PERMISSIONS = ['hostel.read', 'hostel.manage', 'hostel.allocate'];
const READ_ONLY_PERMISSIONS = ['hostel.read'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.5 exit test: `frontend/src/features/hostel/api.ts`'s
 * assumed shapes hitting the real endpoints — hostel/room CRUD with the room-delete-blocked-
 * while-occupied and hostel-delete-blocked-while-rooms-exist guards, `available`/`occupancy`
 * server-computed reads, the allocate/reassign/vacate lifecycle (bed-range, bed-clash, and
 * already-resident/already-vacated guards), visitor check-in/out, complaint create + resolve
 * (`resolvedAt` tracking the current resolved state, not a one-way flag), and tenant/permission
 * isolation — `hostel.allocate` is a separate permission from `hostel.manage`, exercised on its
 * own.
 */
describe('Hostel (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let readOnlyToken: string;
  let tenantBToken: string;

  let studentAId: string;
  let studentA2Id: string;

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
    const email = `hostel-e2e-${randomUUID()}@example.test`;
    const roleKey = `hostel_e2e_role_${randomUUID()}`;
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
        name: 'Hostel E2E Tenant A',
        slug: `hea-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Hostel E2E Tenant B',
        slug: `heb-${tenantBId}`,
      },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 8', gradeLevel: 8 },
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
        admissionNumber: 'A-HST-1',
        name: 'Hana Hostel',
        dob: new Date('2012-01-01'),
        gender: 'female',
        classId: schoolClass.id,
        sectionId: section.id,
        academicYearId: academicYear.id,
      },
    });
    studentAId = studentA.id;
    const studentA2 = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'A-HST-2',
        name: 'Hank Hostel',
        dob: new Date('2012-02-01'),
        gender: 'male',
        classId: schoolClass.id,
        sectionId: section.id,
        academicYearId: academicYear.id,
      },
    });
    studentA2Id = studentA2.id;

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      HOSTEL_PERMISSIONS,
      'Hostel Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      HOSTEL_PERMISSIONS,
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

  let hostelId: string;
  let roomId: string;
  let secondRoomId: string;
  let allocationId: string;

  describe('Hostels', () => {
    it('403s creating a hostel for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/hostels')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          name: 'Boys Hostel A',
          type: 'boys',
          address: '',
          wardenName: '',
          notes: '',
        });
      expect(res.status).toBe(403);
    });

    it('creates a hostel', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/hostels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Boys Hostel A',
          type: 'boys',
          address: '123 Campus Rd',
          wardenName: 'Mr. Warden',
          notes: '',
        });
      expect(res.status).toBe(201);
      hostelId = body<{ id: string }>(res).id;
    });

    it('lists hostels including the created one', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/hostels')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((h) => h.id === hostelId)).toBe(true);
    });
  });

  describe('Rooms', () => {
    it('400s creating a room against a nonexistent hostel', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostelId: randomUUID(),
          floorLabel: '',
          roomNumber: '101',
          capacity: 2,
          roomType: 'shared',
        });
      expect(res.status).toBe(400);
    });

    it('creates a room with capacity 2', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostelId,
          floorLabel: '1st Floor',
          roomNumber: '101',
          capacity: 2,
          roomType: 'shared',
        });
      expect(res.status).toBe(201);
      const room = body<{ id: string; occupiedBeds: number }>(res);
      expect(room.occupiedBeds).toBe(0);
      roomId = room.id;
    });

    it('creates a second room with capacity 1', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostelId,
          floorLabel: '1st Floor',
          roomNumber: '102',
          capacity: 1,
          roomType: 'private',
        });
      expect(res.status).toBe(201);
      secondRoomId = body<{ id: string }>(res).id;
    });

    it('lists rooms filtered by hostel', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/rooms')
        .query({ page: 1, pageSize: 20, hostelId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[]; total: number }>(res);
      expect(page.items.map((r) => r.id).sort()).toEqual(
        [roomId, secondRoomId].sort(),
      );
    });

    it('409s deleting the hostel while it still has rooms', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/hostel/hostels/${hostelId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('lists both rooms as available before any allocation', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/rooms/available')
        .query({ hostelId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const rooms = body<{ id: string }[]>(res);
      expect(rooms.map((r) => r.id).sort()).toEqual(
        [roomId, secondRoomId].sort(),
      );
    });
  });

  describe('Allocations', () => {
    it('403s allocating for a read-only caller (lacks hostel.allocate)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ studentId: studentAId, roomId, bedNumber: 1 });
      expect(res.status).toBe(403);
    });

    it('400s a bed number out of range', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentAId, roomId, bedNumber: 5 });
      expect(res.status).toBe(400);
    });

    it('400s a nonexistent student', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: randomUUID(), roomId, bedNumber: 1 });
      expect(res.status).toBe(400);
    });

    it('allocates a student to bed 1', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentAId, roomId, bedNumber: 1 });
      expect(res.status).toBe(201);
      const allocation = body<{
        id: string;
        studentLabel: string;
        hostelName: string;
        roomLabel: string;
        status: string;
      }>(res);
      expect(allocation.studentLabel).toBe('Hana Hostel');
      expect(allocation.hostelName).toBe('Boys Hostel A');
      expect(allocation.roomLabel).toBe('101');
      expect(allocation.status).toBe('active');
      allocationId = allocation.id;
    });

    it('409s allocating the same bed to another student', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentA2Id, roomId, bedNumber: 1 });
      expect(res.status).toBe(409);
    });

    it('409s allocating the already-resident student to a different room', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentAId, roomId: secondRoomId, bedNumber: 1 });
      expect(res.status).toBe(409);
    });

    it('room now shows occupiedBeds: 1', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/rooms')
        .query({ page: 1, pageSize: 20, hostelId })
        .set('Authorization', `Bearer ${adminToken}`);
      const page = body<{ items: { id: string; occupiedBeds: number }[] }>(res);
      const room = page.items.find((r) => r.id === roomId);
      expect(room?.occupiedBeds).toBe(1);
    });

    it('excludes the full second room from availability once occupied', async () => {
      await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentA2Id, roomId: secondRoomId, bedNumber: 1 });

      const res = await request(app.getHttpServer())
        .get('/v1/hostel/rooms/available')
        .query({ hostelId })
        .set('Authorization', `Bearer ${adminToken}`);
      const rooms = body<{ id: string }[]>(res);
      expect(rooms.map((r) => r.id)).toEqual([roomId]);
    });

    it("gets room 101's occupancy grid", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/hostel/rooms/${roomId}/occupancy`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const occupancy = body<{
        capacity: number;
        occupants: { bedNumber: number; studentLabel: string }[];
      }>(res);
      expect(occupancy.capacity).toBe(2);
      expect(occupancy.occupants).toHaveLength(1);
      expect(occupancy.occupants[0].bedNumber).toBe(1);
      expect(occupancy.occupants[0].studentLabel).toBe('Hana Hostel');
    });

    it('lists allocations filtered by hostel and status', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/allocations')
        .query({ page: 1, pageSize: 20, hostelId, status: 'active' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[]; total: number }>(res);
      expect(page.total).toBe(2);
      expect(page.items.some((a) => a.id === allocationId)).toBe(true);
    });

    it('403s reassigning for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/hostel/allocations/${allocationId}/reassign`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ roomId, bedNumber: 2 });
      expect(res.status).toBe(403);
    });

    it('reassigns to bed 2 in the same room', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/hostel/allocations/${allocationId}/reassign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roomId, bedNumber: 2 });
      expect(res.status).toBe(200);
      expect(body<{ bedNumber: number }>(res).bedNumber).toBe(2);
    });

    it('409s reassigning into a bed occupied by another active allocation', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/hostel/allocations/${allocationId}/reassign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roomId: secondRoomId, bedNumber: 1 });
      expect(res.status).toBe(409);
    });

    it('409s deleting a room with an active resident', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/hostel/rooms/${roomId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('vacates the allocation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/hostel/allocations/${allocationId}/vacate`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const allocation = body<{ status: string; vacatedAt: string | null }>(
        res,
      );
      expect(allocation.status).toBe('vacated');
      expect(allocation.vacatedAt).not.toBeNull();
    });

    it('409s vacating an already-vacated allocation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/hostel/allocations/${allocationId}/vacate`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('allows re-allocating the now-freed student elsewhere', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/allocate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentId: studentAId, roomId, bedNumber: 1 });
      expect(res.status).toBe(201);
    });

    it("404s a cross-tenant allocations list scoping (tenant B sees none of tenant A's)", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/allocations')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((a) => a.id === allocationId)).toBe(false);
    });
  });

  describe('Visitors', () => {
    let visitorId: string;

    it('400s checking in a visitor against a nonexistent resident', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/visitors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          residentStudentId: randomUUID(),
          residentLabel: 'Nobody',
          visitorName: 'Vera Visitor',
          relation: 'Aunt',
          purpose: '',
        });
      expect(res.status).toBe(400);
    });

    it('checks in a visitor', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/visitors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          residentStudentId: studentAId,
          residentLabel: 'Hana Hostel',
          visitorName: 'Vera Visitor',
          relation: 'Aunt',
          purpose: 'Weekend visit',
        });
      expect(res.status).toBe(201);
      const visitor = body<{ id: string; checkOutAt: string | null }>(res);
      expect(visitor.checkOutAt).toBeNull();
      visitorId = visitor.id;
    });

    it('lists open visitors including the checked-in one', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/visitors')
        .query({ page: 1, pageSize: 20, open: 'true' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((v) => v.id === visitorId)).toBe(true);
    });

    it('checks out the visitor', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/hostel/visitors/${visitorId}/check-out`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(
        body<{ checkOutAt: string | null }>(res).checkOutAt,
      ).not.toBeNull();
    });

    it('409s checking out an already-checked-out visitor', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/hostel/visitors/${visitorId}/check-out`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('no longer lists the visitor under open=true', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/visitors')
        .query({ page: 1, pageSize: 20, open: 'true' })
        .set('Authorization', `Bearer ${adminToken}`);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((v) => v.id === visitorId)).toBe(false);
    });
  });

  describe('Complaints', () => {
    let complaintId: string;

    it('400s a nonexistent hostel', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/complaints')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostelId: randomUUID(),
          roomId: null,
          residentStudentId: null,
          residentLabel: '',
          category: 'maintenance',
          description: 'Leaky faucet',
        });
      expect(res.status).toBe(400);
    });

    it("400s a room that doesn't belong to the given hostel", async () => {
      const otherHostelRes = await request(app.getHttpServer())
        .post('/v1/hostel/hostels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Girls Hostel B',
          type: 'girls',
          address: '',
          wardenName: '',
          notes: '',
        });
      const otherHostelId = body<{ id: string }>(otherHostelRes).id;

      const res = await request(app.getHttpServer())
        .post('/v1/hostel/complaints')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostelId: otherHostelId,
          roomId,
          residentStudentId: null,
          residentLabel: '',
          category: 'maintenance',
          description: 'Wrong hostel room',
        });
      expect(res.status).toBe(400);

      await request(app.getHttpServer())
        .delete(`/v1/hostel/hostels/${otherHostelId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    });

    it('403s creating a complaint for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/complaints')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          hostelId,
          roomId: null,
          residentStudentId: null,
          residentLabel: '',
          category: 'food',
          description: 'Cold food',
        });
      expect(res.status).toBe(403);
    });

    it('creates a complaint with a room and resident', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/complaints')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostelId,
          roomId,
          residentStudentId: studentAId,
          residentLabel: 'Hana Hostel',
          category: 'maintenance',
          description: 'Leaky faucet',
        });
      expect(res.status).toBe(201);
      const complaint = body<{
        id: string;
        hostelName: string;
        roomLabel: string | null;
        status: string;
        resolvedAt: string | null;
      }>(res);
      expect(complaint.hostelName).toBe('Boys Hostel A');
      expect(complaint.roomLabel).toBe('101');
      expect(complaint.status).toBe('open');
      expect(complaint.resolvedAt).toBeNull();
      complaintId = complaint.id;
    });

    it('creates a complaint with neither room nor resident (mess hall)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hostel/complaints')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostelId,
          roomId: null,
          residentStudentId: null,
          residentLabel: '',
          category: 'food',
          description: 'Mess hall is cold',
        });
      expect(res.status).toBe(201);
      const complaint = body<{
        roomId: string | null;
        residentStudentId: string | null;
      }>(res);
      expect(complaint.roomId).toBeNull();
      expect(complaint.residentStudentId).toBeNull();
    });

    it('lists complaints filtered by hostel and status', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/complaints')
        .query({ page: 1, pageSize: 20, hostelId, status: 'open' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[]; total: number }>(res);
      expect(page.total).toBe(2);
      expect(page.items.some((c) => c.id === complaintId)).toBe(true);
    });

    it('resolves the complaint, setting resolvedAt', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/hostel/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'resolved', resolutionNotes: 'Fixed the faucet' });
      expect(res.status).toBe(200);
      const complaint = body<{ status: string; resolvedAt: string | null }>(
        res,
      );
      expect(complaint.status).toBe('resolved');
      expect(complaint.resolvedAt).not.toBeNull();
    });

    it('moving status back off resolved clears resolvedAt', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/hostel/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'in-progress',
          resolutionNotes: 'Reopened, plumber scheduled',
        });
      expect(res.status).toBe(200);
      const complaint = body<{ status: string; resolvedAt: string | null }>(
        res,
      );
      expect(complaint.status).toBe('in-progress');
      expect(complaint.resolvedAt).toBeNull();
    });

    it('404s a cross-tenant complaints list scoping', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hostel/complaints')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((c) => c.id === complaintId)).toBe(false);
    });
  });
});
