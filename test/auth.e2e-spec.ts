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
import type {
  AuthSessionDto,
  MeResponseDto,
  RefreshResponseDto,
  SessionDeviceDto,
} from '../src/auth/dto/auth-response.dto';

/** `supertest`'s `res.body` is `any` by design (content-type-driven) — cast at the boundary instead of littering every assertion with unsafe-member-access disables. */
function body<T>(res: request.Response): T {
  return res.body as T;
}

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) — this is
 * the phase-closing "run the frontend's own contract against the real backend" check
 * `../implementation-plan.md`'s Phase 1 section calls for, expressed as the frontend's assumed
 * request/response shapes (`frontend/src/features/auth/api.ts`) hitting the real endpoints.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;
  let tenantId: string;
  let roleId: string;

  const password = 'correct horse battery staple';
  const email = `auth-e2e-${randomUUID()}@example.test`;

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
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }); // matches main.ts
    await app.init();

    // PlatformPrismaService, not PrismaService: fixture setup runs outside any request context,
    // so the tenant-scoped client would refuse an unscoped write — see that class's own doc
    // comment.
    prisma = app.get(PlatformPrismaService);

    tenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Auth E2E School',
        slug: `auth-e2e-${tenantId}`,
      },
    });
    const role = await prisma.role.upsert({
      where: { key: 'school_admin' },
      update: {},
      create: { key: 'school_admin', label: 'School Admin' },
    });
    roleId = role.id;

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        name: 'Auth E2E User',
        passwordHash,
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.create({
      data: { tenantId, userId: user.id, roleId },
    });
  });

  afterAll(async () => {
    await prisma.userRole.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  it('logs in with the frontend-assumed { identifier, password } shape and returns { accessToken, user, roles, permissions }', async () => {
    const agent = request.agent(app.getHttpServer());

    const loginRes = await agent
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    const login = body<AuthSessionDto>(loginRes);

    expect(loginRes.status).toBe(200);
    expect(typeof login.accessToken).toBe('string');
    expect(login.user).toMatchObject({
      email,
      name: 'Auth E2E User',
      activeBranchId: null,
    });
    expect(login.roles).toEqual(['school_admin']);
    expect(login.permissions).toEqual([]); // seed.ts grants school_admin zero permissions by design

    const setCookie = loginRes.headers['set-cookie'];
    expect(setCookie?.[0]).toMatch(/^refresh_token=/);
    expect(setCookie?.[0]).toMatch(/HttpOnly/i);
    // Never in the response body — SECURITY.md: refresh token is httpOnly-cookie-only.
    expect(JSON.stringify(loginRes.body)).not.toContain('refresh_token');
  });

  it('rejects invalid credentials with the same generic message whether the account exists or not', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password: 'not-the-right-password' });
    const noSuchAccount = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: 'no-such-account@example.test',
        password: 'whatever-12345',
      });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.status).toBe(401);
    expect(body<{ message: string }>(noSuchAccount).message).toBe(
      body<{ message: string }>(wrongPassword).message,
    );
  });

  it('rejects a request with no access token at all', async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it(
    'session bootstrap round-trip: login → GET /auth/me → POST /auth/refresh rotates the ' +
      'cookie and the old one stops working → GET /auth/sessions → logout revokes it',
    async () => {
      const agent = request.agent(app.getHttpServer());
      const loginRes = await agent
        .post('/v1/auth/login')
        .send({ identifier: email, password });
      const accessToken = body<AuthSessionDto>(loginRes).accessToken;
      const originalCookie = loginRes.headers['set-cookie']?.[0];
      expect(originalCookie).toBeDefined();

      const meRes = await agent
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      const me = body<MeResponseDto>(meRes);
      expect(meRes.status).toBe(200);
      expect(me.user.email).toBe(email);
      expect(me.roles).toEqual(['school_admin']);

      const refreshRes = await agent.post('/v1/auth/refresh');
      const refreshed = body<RefreshResponseDto>(refreshRes);
      expect(refreshRes.status).toBe(200);
      expect(refreshed.accessToken).not.toBe(accessToken);
      expect(Object.keys(refreshed)).toEqual(['accessToken']); // never a refreshToken field

      // The pre-rotation cookie is dead now — reuse detection revokes the whole session.
      const replay = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('Cookie', originalCookie);
      expect(replay.status).toBe(401);

      // ...which also kills the *rotated* cookie the legitimate agent was holding.
      const refreshAfterReplay = await agent.post('/v1/auth/refresh');
      expect(refreshAfterReplay.status).toBe(401);
    },
  );

  it("GET /auth/sessions lists the caller's own device as isCurrent, and logout-all clears every device", async () => {
    const agentA = request.agent(app.getHttpServer());
    const agentB = request.agent(app.getHttpServer());

    const loginA = await agentA
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    const tokenA = body<AuthSessionDto>(loginA).accessToken;
    const listSessions = () =>
      agentA
        .get('/v1/auth/sessions')
        .set('Authorization', `Bearer ${tokenA}`)
        .then((res) => body<SessionDeviceDto[]>(res));

    // Compare against a live "before" baseline rather than an assumed absolute count — earlier
    // tests in this file (e.g. the plain login-shape check) deliberately don't log out, so this
    // user can already have other sessions by the time this test runs.
    const before = await listSessions();
    const loginB = await agentB
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    expect(loginB.status).toBe(200);

    const after = await listSessions();
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((d) => d.isCurrent)).toHaveLength(1);

    await agentA
      .post('/v1/auth/logout-all')
      .set('Authorization', `Bearer ${tokenA}`);

    expect((await agentA.post('/v1/auth/refresh')).status).toBe(401);
    expect((await agentB.post('/v1/auth/refresh')).status).toBe(401);
    // The access token itself is still cryptographically valid (stateless JWT, not yet expired) —
    // logout-all revokes *sessions*, not the token in flight. Confirms it actually cleared every
    // session for this user, not just A/B's two, with an absolute check this time.
    expect(await listSessions()).toEqual([]);
  });

  it('forgot-password → reset-password issues a working reset and revokes every existing session', async () => {
    const agent = request.agent(app.getHttpServer());
    const loginRes = await agent
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    expect(loginRes.status).toBe(200);

    // The real delivery channel (PRD §36's notification worker) doesn't exist yet — AuthService
    // logs the token as a documented dev stand-in (see its own doc comment); capture it the same
    // way an operator reading logs would, rather than reaching into Redis/AuthService internals.
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    const forgotRes = await request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .send({ identifier: email });
    expect(forgotRes.status).toBe(200);

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find((msg) => msg.includes('token:'));
    expect(logged).toBeDefined();
    const token = logged!.split('token: ')[1];
    warnSpy.mockRestore();

    const newPassword = 'a brand new password 123';
    const resetRes = await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({ token, password: newPassword });
    expect(resetRes.status).toBe(200);

    // A password reset invalidates every existing session, including the one that requested it.
    expect((await agent.post('/v1/auth/refresh')).status).toBe(401);

    // The reset token is single-use.
    const reuseRes = await request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .send({ token, password: 'yet-another-password' });
    expect(reuseRes.status).toBe(400);

    // The new password actually works, and the old one no longer does.
    const loginWithNew = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password: newPassword });
    expect(loginWithNew.status).toBe(200);

    const loginWithOld = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    expect(loginWithOld.status).toBe(401);
  });
});
