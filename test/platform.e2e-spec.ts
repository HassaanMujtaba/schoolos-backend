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

const ALL_PLATFORM_PERMISSIONS = [
  'platform.schools.manage',
  'platform.subscriptions.manage',
  'platform.billing.read',
  'platform.feature-flags.manage',
  'platform.support.read',
  'platform.audit.read',
];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.9 exit test: `frontend/src/features/platform/api.ts`'s
 * assumed shapes hitting the real endpoints. Unlike every other module's own e2e spec, this one
 * exercises genuinely cross-tenant reads/writes on purpose (`platform-console.md`'s own framing) —
 * there is no "wrong tenant" isolation check here the way every earlier phase's spec has one;
 * instead this proves the opposite: a caller with the right `platform.*` permission legitimately
 * sees data spanning every tenant, gated on permission alone.
 *
 * `Plan`/`FeatureFlag` are global catalogs `prisma/seed.ts` seeds once for the whole database, not
 * per-test fixtures — every test that mutates one restores it in the same `it()` block rather than
 * `afterAll`, so a failing assertion mid-test doesn't leave the seeded catalog corrupted for every
 * other e2e spec sharing this same database.
 */
describe('Platform Console (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let callerTenantId: string;
  let onboardedTenantId: string;
  let adminToken: string;
  let billingReadToken: string;
  let noPermToken: string;

  const password = 'correct horse battery staple';

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: email, password });
    expect(res.status).toBe(200);
    return body<{ accessToken: string }>(res).accessToken;
  }

  async function createCaller(permissionKeys: string[]): Promise<string> {
    const email = `platform-e2e-${randomUUID()}@example.test`;
    const roleKey = `platform_e2e_role_${randomUUID()}`;
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
        tenantId: callerTenantId,
        email,
        name: 'Platform E2E Caller',
        passwordHash,
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.create({
      data: { tenantId: callerTenantId, userId: user.id, roleId: role.id },
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

    // The caller's own tenant deliberately has no `School` row — same shape
    // `prisma/seed.ts`'s real housekeeping tenant has, and it doubles as a check that this
    // caller's own account never shows up in `GET /platform/schools`/`GET /platform/users`
    // (both filter on `school: { isNot: null }`).
    callerTenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: callerTenantId,
        name: 'Platform E2E Caller Tenant',
        slug: `platform-e2e-caller-${callerTenantId}`,
        status: 'ACTIVE',
      },
    });

    [adminToken, billingReadToken, noPermToken] = await Promise.all([
      createCaller(ALL_PLATFORM_PERMISSIONS),
      createCaller(['platform.billing.read']),
      createCaller([]),
    ]);
  });

  afterAll(async () => {
    if (onboardedTenantId) {
      await prisma.platformAuditLog.deleteMany({
        where: { tenantId: onboardedTenantId },
      });
      // Cascades through School/Subscription/BillingRecord/User/UserRole (schema.prisma's own
      // `onDelete: Cascade` on every one of those tenant relations).
      await prisma.tenant.delete({ where: { id: onboardedTenantId } });
    }
    await prisma.userRole.deleteMany({ where: { tenantId: callerTenantId } });
    await prisma.user.deleteMany({ where: { tenantId: callerTenantId } });
    await prisma.tenant.delete({ where: { id: callerTenantId } });
    await app.close();
  });

  describe('permission gating', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/platform/schools',
      );
      expect(res.status).toBe(401);
    });

    it('rejects an authenticated caller with no platform.* permission at all', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/platform/schools')
        .set('Authorization', `Bearer ${noPermToken}`);
      expect(res.status).toBe(403);
    });

    it('gates each sub-area on its own specific platform.* permission, not just "any platform permission"', async () => {
      // billingReadToken only holds platform.billing.read — /platform/billing works, everything
      // else this module gates on a *different* platform.* string correctly 403s.
      expect(
        (
          await request(app.getHttpServer())
            .get('/v1/platform/billing')
            .set('Authorization', `Bearer ${billingReadToken}`)
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app.getHttpServer())
            .get('/v1/platform/schools')
            .set('Authorization', `Bearer ${billingReadToken}`)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .get('/v1/platform/feature-flags')
            .set('Authorization', `Bearer ${billingReadToken}`)
        ).status,
      ).toBe(403);
    });
  });

  describe('school onboarding', () => {
    it('POST /platform/schools provisions a tenant, school, trial subscription, first billing record, an INVITED owner, and an audit row — end to end', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');

      const createRes = await request(app.getHttpServer())
        .post('/v1/platform/schools')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `Sunrise Academy ${randomUUID()}`,
          contactEmail: `admin-${randomUUID()}@sunrise.test`,
          plan: 'professional',
        });
      expect(createRes.status).toBe(201);
      const school = body<{
        id: string;
        name: string;
        status: string;
        plan: string;
        branchCount: number;
        userCount: number;
        studentCount: number;
      }>(createRes);
      expect(school.status).toBe('trial');
      expect(school.plan).toBe('professional');
      expect(school.branchCount).toBe(0);
      expect(school.userCount).toBe(1);
      onboardedTenantId = school.id;

      // The onboarded owner is INVITED, not ACTIVE — can't log in yet with any password.
      const owner = await prisma.user.findFirstOrThrow({
        where: { tenantId: onboardedTenantId },
      });
      expect(owner.status).toBe('INVITED');
      const blockedLogin = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ identifier: owner.email, password: 'whatever' });
      expect(blockedLogin.status).toBe(401);

      // The subscription: trialing, tied to the right plan, with a real first billing record.
      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { tenantId: onboardedTenantId },
        include: { plan: true },
      });
      expect(subscription.status).toBe('TRIALING');
      expect(subscription.plan.tier).toBe('PROFESSIONAL');
      const billingRecord = await prisma.billingRecord.findFirstOrThrow({
        where: { subscriptionId: subscription.id },
      });
      expect(billingRecord.amount).toBe(subscription.plan.priceMonthly);
      expect(billingRecord.status).toBe('PENDING');

      // A platform audit row was written for this action (PlatformAuditLogService, not the
      // generic tenant-scoped AuditInterceptor — see plans.controller.ts's own doc comment on why
      // every platform route is @SkipAudit()).
      const auditRow = await prisma.platformAuditLog.findFirstOrThrow({
        where: { tenantId: onboardedTenantId, action: 'school.onboarded' },
      });
      expect(auditRow.tenantName).toBe(school.name);
      expect(auditRow.actorLabel).not.toBe('');

      // The dev-only invite token AuthService.issueInviteToken logs (same pattern
      // auth.e2e-spec.ts's own forgot-password test uses) actually redeems and activates the
      // account — this is the one path that makes onboarding a school not a dead end.
      const logged = warnSpy.mock.calls
        .map((call) => String(call[0]))
        .find(
          (msg) =>
            msg.includes('Invite issued for user') && msg.includes(owner.id),
        );
      expect(logged).toBeDefined();
      const token = logged!.split('token: ')[1];
      warnSpy.mockRestore();

      const newPassword = 'a brand new owner password 123';
      const resetRes = await request(app.getHttpServer())
        .post('/v1/auth/reset-password')
        .send({ token, password: newPassword });
      expect(resetRes.status).toBe(200);

      const ownerLogin = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ identifier: owner.email, password: newPassword });
      expect(ownerLogin.status).toBe(200);
      expect(body<{ roles: string[] }>(ownerLogin).roles).toEqual([
        'school_owner',
      ]);
    });

    it("GET /platform/schools lists the onboarded school, supports search and status filtering, and never shows the caller's own school-less tenant", async () => {
      const listRes = await request(app.getHttpServer())
        .get('/v1/platform/schools')
        .query({ page: 1, pageSize: 50 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      const { items } = body<{ items: { id: string }[]; total: number }>(
        listRes,
      );
      expect(items.some((s) => s.id === onboardedTenantId)).toBe(true);
      expect(items.some((s) => s.id === callerTenantId)).toBe(false);

      const school = await prisma.school.findUniqueOrThrow({
        where: { tenantId: onboardedTenantId },
      });
      const searchRes = await request(app.getHttpServer())
        .get('/v1/platform/schools')
        .query({ page: 1, pageSize: 50, search: school.name })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(
        body<{ items: { id: string }[] }>(searchRes).items.map((s) => s.id),
      ).toEqual([onboardedTenantId]);

      const wrongStatusRes = await request(app.getHttpServer())
        .get('/v1/platform/schools')
        .query({ page: 1, pageSize: 50, status: 'suspended' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(
        body<{ items: { id: string }[] }>(wrongStatusRes).items.some(
          (s) => s.id === onboardedTenantId,
        ),
      ).toBe(false);
    });

    it('GET /platform/schools/:id returns the detail shape with branches[]', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/platform/schools/${onboardedTenantId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ branches: unknown[] }>(res).branches).toEqual([]);
    });

    it('PATCH /platform/schools/:id suspends and reinstates — the only status transitions this console makes', async () => {
      const suspend = await request(app.getHttpServer())
        .patch(`/v1/platform/schools/${onboardedTenantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'suspended' });
      expect(suspend.status).toBe(200);
      expect(body<{ status: string }>(suspend).status).toBe('suspended');

      const reinstate = await request(app.getHttpServer())
        .patch(`/v1/platform/schools/${onboardedTenantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' });
      expect(reinstate.status).toBe(200);
      expect(body<{ status: string }>(reinstate).status).toBe('active');
    });
  });

  describe('plans', () => {
    it('GET /platform/plans returns the three seeded tiers', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/platform/plans')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const tiers = body<{ tier: string }[]>(res)
        .map((p) => p.tier)
        .sort();
      expect(tiers).toEqual(['enterprise', 'professional', 'starter']);
    });

    it('POST /platform/plans conflicts on a tier that already exists (the three tiers are fixed, not an open catalog)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/platform/plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tier: 'starter',
          name: 'Duplicate Starter',
          priceMonthly: 1,
          maxBranches: 1,
          maxStudents: 1,
          features: [],
        });
      expect(res.status).toBe(409);
    });

    it('PATCH /platform/plans/:id updates price/limits/features and restores them afterward (Plan is a shared global catalog, not a per-test fixture)', async () => {
      const listed = body<
        {
          id: string;
          tier: string;
          priceMonthly: number;
          maxBranches: number;
          maxStudents: number;
          features: string[];
        }[]
      >(
        await request(app.getHttpServer())
          .get('/v1/platform/plans')
          .set('Authorization', `Bearer ${adminToken}`),
      );
      const starter = listed.find((p) => p.tier === 'starter')!;

      try {
        const updateRes = await request(app.getHttpServer())
          .patch(`/v1/platform/plans/${starter.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: starter.tier,
            priceMonthly: 999,
            maxBranches: 9,
            maxStudents: 9000,
            features: ['temp e2e feature'],
          });
        expect(updateRes.status).toBe(200);
        expect(body<{ priceMonthly: number }>(updateRes).priceMonthly).toBe(
          999,
        );
      } finally {
        await request(app.getHttpServer())
          .patch(`/v1/platform/plans/${starter.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Starter',
            priceMonthly: starter.priceMonthly,
            maxBranches: starter.maxBranches,
            maxStudents: starter.maxStudents,
            features: starter.features,
          });
      }
    });
  });

  describe('subscriptions & billing', () => {
    it('GET /platform/subscriptions shows the onboarded school trialing with $0 MRR (a trial contributes no recurring revenue)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/platform/subscriptions')
        .query({ page: 1, pageSize: 50 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const row = body<{
        items: { tenantId: string; status: string; mrr: number }[];
      }>(res).items.find((s) => s.tenantId === onboardedTenantId);
      expect(row?.status).toBe('trialing');
      expect(row?.mrr).toBe(0);
    });

    it('an ACTIVE subscription contributes its plan price to MRR', async () => {
      await prisma.subscription.update({
        where: { tenantId: onboardedTenantId },
        data: { status: 'ACTIVE', trialEndsAt: null },
      });
      const res = await request(app.getHttpServer())
        .get('/v1/platform/subscriptions')
        .query({ page: 1, pageSize: 50 })
        .set('Authorization', `Bearer ${adminToken}`);
      const row = body<{
        items: {
          tenantId: string;
          status: string;
          mrr: number;
          plan: string;
        }[];
      }>(res).items.find((s) => s.tenantId === onboardedTenantId);
      expect(row?.status).toBe('active');
      expect(row?.mrr).toBeGreaterThan(0);
    });

    it('PATCH /platform/subscriptions/:id cancels — status becomes canceled and MRR drops back to $0', async () => {
      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { tenantId: onboardedTenantId },
      });
      const res = await request(app.getHttpServer())
        .patch(`/v1/platform/subscriptions/${subscription.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cancelAtPeriodEnd: true });
      expect(res.status).toBe(200);
      const updated = body<{ status: string; mrr: number }>(res);
      expect(updated.status).toBe('canceled');
      expect(updated.mrr).toBe(0);
    });

    it('rejects changing plan and canceling in the same request as ambiguous', async () => {
      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { tenantId: onboardedTenantId },
      });
      const res = await request(app.getHttpServer())
        .patch(`/v1/platform/subscriptions/${subscription.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ plan: 'enterprise', cancelAtPeriodEnd: true });
      expect(res.status).toBe(400);
    });

    it('GET /platform/billing shows the first billing record for the onboarded school', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/platform/billing')
        .query({ page: 1, pageSize: 50 })
        .set('Authorization', `Bearer ${billingReadToken}`);
      expect(res.status).toBe(200);
      const row = body<{ items: { tenantId: string; status: string }[] }>(
        res,
      ).items.find((r) => r.tenantId === onboardedTenantId);
      expect(row).toBeDefined();
      expect(row?.status).toBe('pending');
    });

    it("the webhook endpoint is public but refuses to process anything when Stripe isn't configured (this test environment has no STRIPE_SECRET_KEY)", async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/platform/billing/webhook')
        .set('stripe-signature', 't=1,v1=fake')
        .send({ type: 'invoice.paid' });
      expect(res.status).toBe(400);
    });
  });

  describe('users, feature flags, usage, system health, audit logs', () => {
    it("GET /platform/users finds the onboarded school's owner by name/email search, never the caller's own school-less account", async () => {
      const owner = await prisma.user.findFirstOrThrow({
        where: { tenantId: onboardedTenantId },
      });
      const res = await request(app.getHttpServer())
        .get('/v1/platform/users')
        .query({ page: 1, pageSize: 20, search: owner.email })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const items = body<{
        items: { id: string; tenantId: string; roles: string[] }[];
      }>(res).items;
      expect(items.map((u) => u.id)).toContain(owner.id);
      expect(items.some((u) => u.tenantId === callerTenantId)).toBe(false);
    });

    it('GET/PATCH /platform/feature-flags lists the seeded catalog and toggles + restores one', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/v1/platform/feature-flags')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      const flags =
        body<{ id: string; key: string; enabled: boolean }[]>(listRes);
      const hostelFlag = flags.find((f) => f.key === 'hostel_module')!;
      expect(hostelFlag).toBeDefined();
      const originalEnabled = hostelFlag.enabled;

      try {
        const toggleRes = await request(app.getHttpServer())
          .patch(`/v1/platform/feature-flags/${hostelFlag.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ enabled: !originalEnabled });
        expect(toggleRes.status).toBe(200);
        expect(body<{ enabled: boolean }>(toggleRes).enabled).toBe(
          !originalEnabled,
        );
      } finally {
        await request(app.getHttpServer())
          .patch(`/v1/platform/feature-flags/${hostelFlag.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ enabled: originalEnabled });
      }
    });

    it('GET /platform/usage returns real numeric aggregates (loose bounds — this database is shared across every e2e spec file)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/platform/usage')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const usage = body<{
        activeSchools: number;
        storageUsedGb: number;
        apiCallsToday: number;
        backgroundJobsPending: number;
      }>(res);
      expect(usage.activeSchools).toBeGreaterThanOrEqual(1);
      expect(usage.storageUsedGb).toBeGreaterThanOrEqual(0);
      // Honestly-flagged placeholders (usage.service.ts's own doc comment) — no instrumentation
      // exists yet, so these must be exactly 0, not a fabricated number.
      expect(usage.apiCallsToday).toBe(0);
      expect(usage.backgroundJobsPending).toBe(0);
    });

    it('GET /platform/system-health pings the real Postgres/Redis/storage this test run is itself using', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/platform/system-health')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const health = body<{
        services: { id: string; status: string }[];
        jobQueues: unknown[];
      }>(res);
      expect(health.services.map((s) => s.id).sort()).toEqual([
        'postgres',
        'redis',
        'storage',
      ]);
      for (const service of health.services) {
        expect(service.status).toBe('operational');
      }
      expect(health.jobQueues).toEqual([]);
    });

    it("GET /platform/audit-logs includes the school.onboarded row this suite's own onboarding call wrote", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/platform/audit-logs')
        .query({ page: 1, pageSize: 50 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const items = body<{ items: { action: string; tenantName?: string }[] }>(
        res,
      ).items;
      expect(items.some((e) => e.action === 'school.onboarded')).toBe(true);
    });
  });
});
