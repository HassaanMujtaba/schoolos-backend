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

const COMMUNICATION_PERMISSIONS = [
  'messages.send',
  'announcements.read',
  'announcements.create',
  'events.manage',
  'ptm.manage',
  'ptm.book',
];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.7 exit test:
 * `frontend/src/features/communication/api.ts`'s assumed shapes hitting the real endpoints —
 * notifications (unread-count, preferences default/replace), messaging (individual thread
 * create→reply→read, the `Parent.userId` documented-gap 400), announcements (`announcements.read`
 * gate), events (manual create + the `Holiday` `isExternal` mirror), PTM (`teacherId=me` slot
 * create → book → cancel), and tenant isolation.
 */
describe('Communication (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let tenantBToken: string;

  let classId: string;
  let teacherId: string;
  let teacherToken: string;
  let studentId: string;
  let parentId: string;
  let parentToken: string;
  let parentUserId: string;

  const password = 'correct horse battery staple';

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    expect(res.status).toBe(200);
    return body<{ accessToken: string }>(res).accessToken;
  }

  /** Grants a fresh role carrying `permissionKeys` to an already-created `userId` — used for the teacher/parent portal users created directly below, which start with zero permissions same as every other seeded role. */
  async function grantPermissions(
    tenantId: string,
    userId: string,
    permissionKeys: string[],
  ): Promise<void> {
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });
    const role = await prisma.role.create({
      data: {
        key: `communication_e2e_role_${randomUUID()}`,
        label: 'communication e2e',
      },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    await prisma.userRole.create({
      data: { tenantId, userId, roleId: role.id },
    });
  }

  async function createUserWithPermissions(
    tenantId: string,
    permissionKeys: string[],
    name = 'E2E User',
  ): Promise<string> {
    const passwordHash = await bcrypt.hash(password, 10);
    const email = `communication-e2e-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: { tenantId, email, name, passwordHash, status: 'ACTIVE' },
    });
    await grantPermissions(tenantId, user.id, permissionKeys);
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
        name: 'Communication E2E Tenant A',
        slug: `ca-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Communication E2E Tenant B',
        slug: `cb-${tenantBId}`,
      },
    });

    const schoolClass = await prisma.schoolClass.create({
      data: { tenantId: tenantAId, name: 'Grade 5', gradeLevel: 5 },
    });
    classId = schoolClass.id;
    const section = await prisma.section.create({
      data: { tenantId: tenantAId, classId, name: 'A', roomLabel: 'Room 5A' },
    });
    const academicYear = await prisma.academicYear.create({
      data: {
        tenantId: tenantAId,
        name: '2026-2027',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });

    const teacherUser = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: `teacher-portal-${randomUUID()}@example.test`,
        name: 'Portal Teacher',
        passwordHash: await bcrypt.hash(password, 10),
        status: 'ACTIVE',
      },
    });
    const teacher = await prisma.teacher.create({
      data: {
        tenantId: tenantAId,
        name: 'Ms. Rivera',
        employeeId: 'EMP-COMM-1',
        userId: teacherUser.id,
      },
    });
    teacherId = teacher.id;
    await grantPermissions(tenantAId, teacherUser.id, ['ptm.manage']);

    const student = await prisma.student.create({
      data: {
        tenantId: tenantAId,
        admissionNumber: 'A-COMM-1',
        name: 'Alice',
        dob: new Date('2016-01-01'),
        gender: 'female',
        classId,
        sectionId: section.id,
        academicYearId: academicYear.id,
      },
    });
    studentId = student.id;

    const parentUser = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: `parent-portal-${randomUUID()}@example.test`,
        name: 'Portal Parent',
        passwordHash: await bcrypt.hash(password, 10),
        status: 'ACTIVE',
      },
    });
    parentUserId = parentUser.id;
    const parent = await prisma.parent.create({
      data: {
        tenantId: tenantAId,
        userId: parentUser.id,
        name: 'Portal Parent',
        phone: '555-0100',
      },
    });
    parentId = parent.id;
    await prisma.parentStudentLink.create({
      data: {
        tenantId: tenantAId,
        parentId,
        studentId,
        relation: 'mother',
      },
    });
    await grantPermissions(tenantAId, parentUser.id, ['ptm.book']);

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      COMMUNICATION_PERMISSIONS,
      'Communication Admin',
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      COMMUNICATION_PERMISSIONS,
    );

    adminToken = await loginAs(adminEmail);
    tenantBToken = await loginAs(tenantBEmail);
    teacherToken = await loginAs(teacherUser.email);
    parentToken = await loginAs(parentUser.email);
  });

  afterAll(async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await prisma.userRole.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await app.close();
  });

  describe('Notifications', () => {
    it('starts with a zero unread count and no rows', async () => {
      const countRes = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${parentToken}`);
      expect(countRes.status).toBe(200);
      expect(body<{ count: number }>(countRes).count).toBe(0);
    });

    it('defaults every preference type to [inApp] until customized', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/notifications/preferences')
        .set('Authorization', `Bearer ${parentToken}`);
      expect(res.status).toBe(200);
      const prefs = body<{ type: string; channels: string[] }[]>(res);
      expect(prefs.length).toBe(9);
      expect(
        prefs.every(
          (p) => p.channels.length === 1 && p.channels[0] === 'inApp',
        ),
      ).toBe(true);
    });

    it('replaces the full preference set on PUT', async () => {
      const putRes = await request(app.getHttpServer())
        .put('/v1/notifications/preferences')
        .set('Authorization', `Bearer ${parentToken}`)
        .send({
          preferences: [{ type: 'message', channels: ['inApp', 'email'] }],
        });
      expect(putRes.status).toBe(200);

      const res = await request(app.getHttpServer())
        .get('/v1/notifications/preferences')
        .set('Authorization', `Bearer ${parentToken}`);
      const messagePref = body<{ type: string; channels: string[] }[]>(
        res,
      ).find((p) => p.type === 'message');
      expect(messagePref?.channels.sort()).toEqual(['email', 'inApp']);
    });
  });

  let threadId: string;

  describe('Messaging', () => {
    it('403s starting a thread without messages.send', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/messages/threads')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          recipientType: 'individual',
          recipientId: parentId,
          recipientLabel: 'Portal Parent',
          subject: 'No permission',
          body: 'Should not work',
        });
      expect(res.status).toBe(403);
    });

    it('400s a recipient with no portal account linked yet', async () => {
      const unlinkedParent = await prisma.parent.create({
        data: { tenantId: tenantAId, name: 'No Portal', phone: '555-0199' },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/messages/threads')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recipientType: 'individual',
          recipientId: unlinkedParent.id,
          recipientLabel: 'No Portal',
          subject: 'Unreachable',
          body: 'Should 400',
        });
      expect(res.status).toBe(400);
    });

    it('creates a thread to a parent, notifying them', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/messages/threads')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recipientType: 'individual',
          recipientId: parentId,
          recipientLabel: 'Portal Parent',
          subject: 'Welcome',
          body: 'Hello and welcome to the term.',
        });
      expect(res.status).toBe(201);
      const created = body<{
        id: string;
        participantLabels: string[];
        messages: unknown[];
        unreadCount: number;
      }>(res);
      expect(created.participantLabels).toContain('Portal Parent');
      expect(created.messages).toHaveLength(1);
      threadId = created.id;

      const countRes = await request(app.getHttpServer())
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${parentToken}`);
      expect(body<{ count: number }>(countRes).count).toBe(1);
    });

    it('the parent sees the thread in their inbox with an unread count', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/messages/threads')
        .set('Authorization', `Bearer ${parentToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string; unreadCount: number }[] }>(res);
      const thread = page.items.find((t) => t.id === threadId);
      expect(thread?.unreadCount).toBe(1);
    });

    it('the parent replies, and the sender sees it', async () => {
      const replyRes = await request(app.getHttpServer())
        .post(`/v1/messages/threads/${threadId}/messages`)
        .set('Authorization', `Bearer ${parentToken}`)
        .send({ body: 'Thank you!' });
      expect(replyRes.status).toBe(201);

      const detailRes = await request(app.getHttpServer())
        .get(`/v1/messages/threads/${threadId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detailRes.status).toBe(200);
      const detail = body<{ messages: { body: string; readAt: null }[] }>(
        detailRes,
      );
      expect(detail.messages.map((m) => m.body)).toContain('Thank you!');
      expect(detail.messages.every((m) => m.readAt === null)).toBe(true);
    });

    it('marking the thread read zeroes the unread count', async () => {
      const markRes = await request(app.getHttpServer())
        .patch(`/v1/messages/threads/${threadId}/read`)
        .set('Authorization', `Bearer ${parentToken}`);
      expect(markRes.status).toBe(204);

      const res = await request(app.getHttpServer())
        .get('/v1/messages/threads')
        .set('Authorization', `Bearer ${parentToken}`);
      const page = body<{ items: { id: string; unreadCount: number }[] }>(res);
      expect(page.items.find((t) => t.id === threadId)?.unreadCount).toBe(0);
    });

    it('404s a non-participant reading the thread', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/messages/threads/${threadId}`)
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(res.status).toBe(404);
    });
  });

  let announcementId: string;

  describe('Announcements', () => {
    it('403s listing without announcements.read', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/announcements')
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(res.status).toBe(403);
    });

    it('creates a school-wide announcement', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/announcements')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Term begins',
          body: 'Welcome back!',
          audience: 'school',
          classIds: [],
          pinned: true,
        });
      expect(res.status).toBe(201);
      const created = body<{ id: string; classIds: string[] }>(res);
      expect(created.classIds).toEqual([]);
      announcementId = created.id;
    });

    it('lists it, pinned first', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/announcements')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items[0].id).toBe(announcementId);
    });

    it('404s a class audience with a bogus class id', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/announcements')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Bad class',
          body: 'x',
          audience: 'class',
          classIds: [randomUUID()],
          pinned: false,
        });
      expect(res.status).toBe(404);
    });

    it('deletes it', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/announcements/${announcementId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });
  });

  describe('Events & Calendar', () => {
    it('creates a manual event, visible unauthenticated-permission-wise to any caller', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/v1/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Sports Day',
          type: 'sports-day',
          date: '2026-10-15',
          startTime: '09:00',
          endTime: '13:00',
          location: 'Main field',
          description: '',
          audience: 'school',
          classIds: [],
        });
      expect(createRes.status).toBe(201);
      expect(body<{ type: string }>(createRes).type).toBe('sports-day');

      const listRes = await request(app.getHttpServer())
        .get('/v1/events')
        .query({ from: '2026-10-01', to: '2026-10-31' })
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(listRes.status).toBe(200);
      const events = body<{ title: string; isExternal: boolean }[]>(listRes);
      expect(
        events.some((e) => e.title === 'Sports Day' && e.isExternal === false),
      ).toBe(true);
    });

    it('merges a Holiday as a read-only isExternal entry', async () => {
      const academicYear = await prisma.academicYear.findFirstOrThrow({
        where: { tenantId: tenantAId },
      });
      await prisma.holiday.create({
        data: {
          tenantId: tenantAId,
          academicYearId: academicYear.id,
          name: 'Founders Day',
          date: new Date('2026-10-20'),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/v1/events')
        .query({ from: '2026-10-01', to: '2026-10-31' })
        .set('Authorization', `Bearer ${teacherToken}`);
      const events =
        body<{ title: string; isExternal: boolean; id: string }[]>(res);
      const holidayEvent = events.find((e) => e.title === 'Founders Day');
      expect(holidayEvent?.isExternal).toBe(true);

      // A synthetic holiday id never matches a real Event row.
      const deleteRes = await request(app.getHttpServer())
        .delete(`/v1/events/${holidayEvent?.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteRes.status).toBe(404);
    });
  });

  describe('Parent-Teacher Meetings', () => {
    let slotId: string;

    it("creates a slot for the caller's own teacherId=me record", async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/ptm/slots')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({ date: '2026-10-22', startTime: '10:00', endTime: '10:30' });
      expect(res.status).toBe(201);
      const slot = body<{ id: string; teacherId: string }>(res);
      expect(slot.teacherId).toBe(teacherId);
      slotId = slot.id;
    });

    it('lists it as available', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/ptm/availability')
        .query({ teacherId, onlyAvailable: 'true' })
        .set('Authorization', `Bearer ${parentToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }[]>(res).some((s) => s.id === slotId)).toBe(
        true,
      );
    });

    it('the parent books it for their linked child', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/ptm/book')
        .set('Authorization', `Bearer ${parentToken}`)
        .send({ slotId, studentId });
      expect(res.status).toBe(201);
      const booked = body<{
        bookedByParentId: string | null;
        studentLabel: string | null;
      }>(res);
      expect(booked.bookedByParentId).toBe(parentUserId);
      expect(booked.studentLabel).toBe('Alice');
    });

    it('409s a second booking attempt on the same slot', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/ptm/book')
        .set('Authorization', `Bearer ${parentToken}`)
        .send({ slotId, studentId });
      expect(res.status).toBe(409);
    });

    it('the teacher sees it in their own availability, no longer available', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/ptm/availability')
        .query({ teacherId: 'me', onlyAvailable: 'true' })
        .set('Authorization', `Bearer ${teacherToken}`);
      expect(body<{ id: string }[]>(res).some((s) => s.id === slotId)).toBe(
        false,
      );
    });

    it('the teacher records post-meeting notes', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/ptm/bookings/${slotId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          notes: 'Discussed progress',
          followUpAction: 'Send reading list',
        });
      expect(res.status).toBe(200);
      expect(body<{ notes: string }>(res).notes).toBe('Discussed progress');
    });

    it('the parent cancels their own booking, freeing the slot', async () => {
      const cancelRes = await request(app.getHttpServer())
        .post(`/v1/ptm/bookings/${slotId}/cancel`)
        .set('Authorization', `Bearer ${parentToken}`);
      expect(cancelRes.status).toBe(204);

      const res = await request(app.getHttpServer())
        .get('/v1/ptm/availability')
        .query({ teacherId, onlyAvailable: 'true' })
        .set('Authorization', `Bearer ${parentToken}`);
      expect(body<{ id: string }[]>(res).some((s) => s.id === slotId)).toBe(
        true,
      );
    });
  });

  describe('Tenant isolation', () => {
    it("a different tenant's caller sees no events from tenant A", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/events')
        .query({ from: '2026-10-01', to: '2026-10-31' })
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(200);
      const events = body<{ title: string }[]>(res);
      expect(events.some((e) => e.title === 'Sports Day')).toBe(false);
    });
  });
});
