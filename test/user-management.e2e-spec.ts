import {
  INestApplication,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';

function body<T>(res: request.Response): T {
  return res.body as T;
}

const ALL_USER_PERMISSIONS = [
  'users.read',
  'users.create',
  'users.update',
  'users.deactivate',
];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment). Proves
 * `user-management/` end to end: creating a staff account, the invite → reset-password → login
 * flow reusing `AuthService`'s existing machinery, role reassignment, and suspend/reactivate —
 * plus, like every other tenant-scoped module's own e2e spec, a genuine cross-tenant isolation
 * check (tenant B never sees or can touch tenant A's users) — this one doubling as proof that
 * `UserManagementService.create`'s `$transaction` callback still tenant-scopes correctly (the
 * tenant-scoping extension is applied at the top-level `PrismaService`; this is the first tenant-
 * scoped module in this codebase to create rows inside an interactive transaction, so it's worth
 * this test actually exercising that path rather than assuming).
 */
describe('User Management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let noPermToken: string;
  let tenantBToken: string;

  const password = 'correct horse battery staple';

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    expect(res.status).toBe(200);
    return body<{ accessToken: string }>(res).accessToken;
  }

  async function createCaller(
    tenantId: string,
    permissionKeys: string[],
  ): Promise<string> {
    const email = `user-mgmt-e2e-${randomUUID()}@example.test`;
    const roleKey = `user_mgmt_e2e_role_${randomUUID()}`;
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
        name: 'E2E Caller',
        passwordHash,
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id },
    });
    return loginAs(email);
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
    await prisma.tenant.createMany({
      data: [
        {
          id: tenantAId,
          name: 'User Mgmt E2E Tenant A',
          slug: `user-mgmt-e2e-a-${tenantAId}`,
        },
        {
          id: tenantBId,
          name: 'User Mgmt E2E Tenant B',
          slug: `user-mgmt-e2e-b-${tenantBId}`,
        },
      ],
    });

    [adminToken, noPermToken, tenantBToken] = await Promise.all([
      createCaller(tenantAId, ALL_USER_PERMISSIONS),
      createCaller(tenantAId, []),
      createCaller(tenantBId, ALL_USER_PERMISSIONS),
    ]);
  });

  afterAll(async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await prisma.userRole.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.role.deleteMany({
        where: { key: { startsWith: 'user_mgmt_e2e_role_' } },
      });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await app.close();
  });

  it('rejects a caller with no users.* permission', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/users')
      .set('Authorization', `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /users/assignable-roles returns the staff catalog — never super_admin/student/parent', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/users/assignable-roles')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const keys = body<{ key: string }[]>(res).map((r) => r.key);
    expect(keys).toContain('teacher');
    expect(keys).toContain('school_admin');
    expect(keys).not.toContain('super_admin');
    expect(keys).not.toContain('student');
    expect(keys).not.toContain('parent');
  });

  let createdUserId: string;
  let createdUserEmail: string;

  it('POST /users creates an INVITED staff account with the requested roles, and the invite → reset-password → login flow works end to end', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    createdUserEmail = `new-teacher-${randomUUID()}@example.test`;

    const createRes = await request(app.getHttpServer())
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Jordan Teacher',
        email: createdUserEmail,
        roleKeys: ['teacher'],
      });
    expect(createRes.status).toBe(201);
    const created = body<{
      id: string;
      status: string;
      roles: string[];
    }>(createRes);
    expect(created.status).toBe('invited');
    expect(created.roles).toEqual(['teacher']);
    createdUserId = created.id;

    // Created inside UserManagementService.create's $transaction — confirms the tenant-scoping
    // extension still stamps tenantId correctly for rows created via an interactive transaction's
    // `tx` client, not just the top-level one.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: createdUserId },
    });
    expect(row.tenantId).toBe(tenantAId);

    const blockedLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: createdUserEmail, password: 'whatever' });
    expect(blockedLogin.status).toBe(401);

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find(
        (msg) =>
          msg.includes('Welcome to SchoolOS') && msg.includes(createdUserEmail),
      );
    expect(logged).toBeDefined();
    const token = logged!.match(/token=([^"&\s]+)/)?.[1];
    expect(token).toBeDefined();
    warnSpy.mockRestore();

    const newPassword = 'a brand new teacher password 123';
    const resetRes = await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({ token, password: newPassword });
    expect(resetRes.status).toBe(200);

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: createdUserEmail, password: newPassword });
    expect(login.status).toBe(200);
    expect(body<{ roles: string[] }>(login).roles).toEqual(['teacher']);
  });

  it('rejects an unknown role key', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bad Role',
        email: `bad-role-${randomUUID()}@example.test`,
        roleKeys: ['super_admin'],
      });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email within the same tenant', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Duplicate',
        email: createdUserEmail,
        roleKeys: ['teacher'],
      });
    expect(res.status).toBe(409);
  });

  it('GET /users finds the created user by name/email search, never a user from another tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/users')
      .query({ page: 1, pageSize: 50, search: 'Jordan Teacher' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const items = body<{ items: { id: string }[] }>(res).items;
    expect(items.map((u) => u.id)).toContain(createdUserId);

    // Tenant B's own admin can't see or touch tenant A's user at all.
    const crossTenantList = await request(app.getHttpServer())
      .get('/v1/users')
      .query({ page: 1, pageSize: 50, search: 'Jordan Teacher' })
      .set('Authorization', `Bearer ${tenantBToken}`);
    expect(
      body<{ items: { id: string }[] }>(crossTenantList).items.some(
        (u) => u.id === createdUserId,
      ),
    ).toBe(false);

    const crossTenantGet = await request(app.getHttpServer())
      .get(`/v1/users/${createdUserId}`)
      .set('Authorization', `Bearer ${tenantBToken}`);
    expect(crossTenantGet.status).toBe(404);
  });

  it('PATCH /users/:id/roles replaces the role set', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/users/${createdUserId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleKeys: ['teacher', 'librarian'] });
    expect(res.status).toBe(200);
    expect(body<{ roles: string[] }>(res).roles.sort()).toEqual([
      'librarian',
      'teacher',
    ]);
  });

  it('PATCH /users/:id/status suspends — login is blocked and the existing session dies immediately — then reactivates', async () => {
    const agent = request.agent(app.getHttpServer());
    const loginRes = await agent.post('/v1/auth/login').send({
      identifier: createdUserEmail,
      password: 'a brand new teacher password 123',
    });
    expect(loginRes.status).toBe(200);

    const suspendRes = await request(app.getHttpServer())
      .patch(`/v1/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'suspended' });
    expect(suspendRes.status).toBe(200);
    expect(body<{ status: string }>(suspendRes).status).toBe('suspended');

    // The session that was active *before* suspension dies immediately (AuthService.logoutAll).
    expect((await agent.post('/v1/auth/refresh')).status).toBe(401);

    const blockedLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: createdUserEmail,
        password: 'a brand new teacher password 123',
      });
    expect(blockedLogin.status).toBe(401);

    const reactivateRes = await request(app.getHttpServer())
      .patch(`/v1/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });
    expect(reactivateRes.status).toBe(200);
    expect(body<{ status: string }>(reactivateRes).status).toBe('active');

    const workingLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: createdUserEmail,
        password: 'a brand new teacher password 123',
      });
    expect(workingLogin.status).toBe(200);
  });
});
