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

const HR_PAYROLL_PERMISSIONS = [
  'hr.read',
  'hr.manage',
  'payroll.read',
  'payroll.run',
  'payroll.approve',
  'leave.approve',
];
const HR_READ_ONLY_PERMISSIONS = ['hr.read', 'payroll.read'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.6 exit test: `frontend/src/features/hr/api.ts` and
 * `frontend/src/features/payroll/api.ts`'s assumed shapes hitting the real endpoints — employee
 * CRUD (`employeeId` uniqueness conflict), the transfer/resignation/termination lifecycle
 * (terminal-state guard), employee leave submit→approve with the `employeeId=me` idiom and its
 * `LeaveBalance.used` increment, salary structure upsert, the payroll period `draft → generated →
 * approved` state machine including the PRD §20 formula's real absence-deduction input, the
 * payslip publish gate (`employeeId=me` only ever sees `approved` periods), and tenant/permission
 * isolation.
 */
describe('HR & Payroll (e2e)', () => {
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
    name = 'E2E User',
  ): Promise<string> {
    const email = `hr-payroll-e2e-${randomUUID()}@example.test`;
    const roleKey = `hr_payroll_e2e_role_${randomUUID()}`;
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

  /** `employeeId=me` idiom — mirrors `academics.e2e-spec.ts`'s `Teacher.userId` linking pattern. */
  async function linkPortalUser(
    tenantId: string,
    employeeId: string,
    permissionKeys: string[],
  ): Promise<string> {
    const email = `hr-payroll-portal-${randomUUID()}@example.test`;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        name: 'Portal Employee',
        passwordHash,
        status: 'ACTIVE',
      },
    });
    await prisma.employee.update({
      where: { id: employeeId },
      data: { userId: user.id },
    });
    if (permissionKeys.length > 0) {
      const permissions = await prisma.permission.findMany({
        where: { key: { in: permissionKeys } },
      });
      const role = await prisma.role.create({
        data: {
          key: `hr_payroll_portal_role_${randomUUID()}`,
          label: 'portal',
        },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
      await prisma.userRole.create({
        data: { tenantId, userId: user.id, roleId: role.id },
      });
    }
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
    await prisma.tenant.create({
      data: {
        id: tenantAId,
        name: 'HR/Payroll E2E Tenant A',
        slug: `hpa-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'HR/Payroll E2E Tenant B',
        slug: `hpb-${tenantBId}`,
      },
    });

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      HR_PAYROLL_PERMISSIONS,
      'HR Admin',
    );
    const readOnlyEmail = await createUserWithPermissions(
      tenantAId,
      HR_READ_ONLY_PERMISSIONS,
    );
    const tenantBEmail = await createUserWithPermissions(
      tenantBId,
      HR_PAYROLL_PERMISSIONS,
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

  let employee1Id: string;
  let employee2Id: string;

  describe('Employee directory & lifecycle', () => {
    it('403s creating an employee for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hr/employees')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          name: 'Nora No-Write',
          email: '',
          phone: '',
          employeeId: 'EMP-000',
          department: 'Ops',
          designation: 'Clerk',
          employmentType: 'full_time',
          dateOfJoining: '2026-01-01',
        });
      expect(res.status).toBe(403);
    });

    it('creates an employee', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hr/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Elena Employee',
          email: 'elena@example.test',
          phone: '555-0100',
          employeeId: 'EMP-001',
          department: 'Operations',
          designation: 'Coordinator',
          employmentType: 'full_time',
          dateOfJoining: '2026-01-15',
        });
      expect(res.status).toBe(201);
      const created = body<{
        id: string;
        status: string;
        lifecycleHistory: unknown[];
      }>(res);
      expect(created.status).toBe('active');
      expect(created.lifecycleHistory).toEqual([]);
      employee1Id = created.id;
    });

    it('409s on a duplicate employeeId within the same tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hr/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplicate Code',
          email: '',
          phone: '',
          employeeId: 'EMP-001',
          department: 'Ops',
          designation: 'Clerk',
          employmentType: 'full_time',
          dateOfJoining: '2026-01-01',
        });
      expect(res.status).toBe(409);
    });

    it('lists and gets the employee', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/v1/hr/employees')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
      const list = body<{ items: Array<{ id: string }>; total: number }>(
        listRes,
      );
      expect(list.items.some((e) => e.id === employee1Id)).toBe(true);

      const getRes = await request(app.getHttpServer())
        .get(`/v1/hr/employees/${employee1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.status).toBe(200);
      expect(body<{ department: string }>(getRes).department).toBe(
        'Operations',
      );
    });

    it('updates the employee', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/hr/employees/${employee1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Elena Employee',
          email: 'elena@example.test',
          phone: '555-0101',
          employeeId: 'EMP-001',
          department: 'Finance',
          designation: 'Coordinator',
          employmentType: 'full_time',
          dateOfJoining: '2026-01-15',
        });
      expect(res.status).toBe(200);
      expect(body<{ phone: string; department: string }>(res).phone).toBe(
        '555-0101',
      );
    });

    it('records a transfer and appends lifecycle history', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hr/transfers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: employee1Id,
          effectiveDate: '2026-02-01',
          reason: 'Department restructuring',
          newDepartment: 'Academics',
          newDesignation: 'Senior Coordinator',
        });
      expect(res.status).toBe(201);
      const updated = body<{
        department: string;
        designation: string;
        status: string;
        lifecycleHistory: Array<{ type: string }>;
      }>(res);
      expect(updated.department).toBe('Academics');
      expect(updated.designation).toBe('Senior Coordinator');
      expect(updated.status).toBe('active');
      expect(updated.lifecycleHistory).toHaveLength(1);
      expect(updated.lifecycleHistory[0].type).toBe('transfer');
    });

    it('records a resignation and flips status', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hr/resignations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: employee1Id,
          effectiveDate: '2026-03-01',
          reason: 'Pursuing another opportunity',
        });
      expect(res.status).toBe(201);
      expect(body<{ status: string }>(res).status).toBe('resigned');
    });

    it('409s a further lifecycle action once resigned (terminal state)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hr/terminations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: employee1Id,
          effectiveDate: '2026-03-15',
          reason: 'N/A',
        });
      expect(res.status).toBe(409);
    });

    it('creates a second, active employee for the payroll/leave flows below', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/hr/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Priya Payroll',
          email: '',
          phone: '',
          employeeId: 'EMP-002',
          department: 'Finance',
          designation: 'Accountant',
          employmentType: 'full_time',
          dateOfJoining: '2026-01-01',
        });
      expect(res.status).toBe(201);
      employee2Id = body<{ id: string }>(res).id;
    });
  });

  let employee2Token: string;
  let leaveRequestId: string;

  describe('Employee leave (§14)', () => {
    it('employeeId=me 404s until a portal user is linked', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/leave/employee/balances')
        .query({ employeeId: 'me' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it('links a portal user to employee 2 and reads seeded balances', async () => {
      employee2Token = await linkPortalUser(tenantAId, employee2Id, []);
      const res = await request(app.getHttpServer())
        .get('/v1/leave/employee/balances')
        .query({ employeeId: 'me' })
        .set('Authorization', `Bearer ${employee2Token}`);
      expect(res.status).toBe(200);
      const balances =
        body<Array<{ leaveType: string; allotted: number; used: number }>>(res);
      expect(balances).toEqual([
        { leaveType: 'casual', allotted: 12, used: 0 },
        { leaveType: 'sick', allotted: 10, used: 0 },
        { leaveType: 'annual', allotted: 15, used: 0 },
        { leaveType: 'unpaid', allotted: 0, used: 0 },
      ]);
    });

    it('submits a leave request for self', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/leave/employee')
        .set('Authorization', `Bearer ${employee2Token}`)
        .send({
          leaveType: 'casual',
          startDate: '2026-04-01',
          endDate: '2026-04-02',
          reason: 'Family event',
        });
      expect(res.status).toBe(201);
      const created = body<{ id: string; status: string; employeeId: string }>(
        res,
      );
      expect(created.status).toBe('pending');
      expect(created.employeeId).toBe(employee2Id);
      leaveRequestId = created.id;
    });

    it("shows up in the caller's own history via employeeId=me", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/leave/employee')
        .query({ employeeId: 'me' })
        .set('Authorization', `Bearer ${employee2Token}`);
      expect(res.status).toBe(200);
      const leaves = body<Array<{ id: string }>>(res);
      expect(leaves.some((l) => l.id === leaveRequestId)).toBe(true);
    });

    it('shows up in the approval queue for an hr.manage/leave.approve caller', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/leave/employee')
        .query({ page: 1, pageSize: 20, status: 'pending' })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: Array<{ id: string }> }>(res);
      expect(page.items.some((l) => l.id === leaveRequestId)).toBe(true);
    });

    it('approves the leave request and increments the matching LeaveBalance.used', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/leave/employee/${leaveRequestId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' });
      expect(res.status).toBe(200);
      expect(body<{ status: string }>(res).status).toBe('approved');

      const balancesRes = await request(app.getHttpServer())
        .get('/v1/leave/employee/balances')
        .query({ employeeId: 'me' })
        .set('Authorization', `Bearer ${employee2Token}`);
      const casual = body<Array<{ leaveType: string; used: number }>>(
        balancesRes,
      ).find((b) => b.leaveType === 'casual');
      // 2026-04-01..2026-04-02 inclusive = 2 days.
      expect(casual?.used).toBe(2);
    });

    it('409s reviewing an already-reviewed request', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/leave/employee/${leaveRequestId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'rejected' });
      expect(res.status).toBe(409);
    });
  });

  let periodId: string;
  let payslipId: string;

  describe('Payroll (§20)', () => {
    it('returns an empty body for a salary structure that has not been set yet', async () => {
      // A JS `null` return sends an empty 200 body, not literal JSON "null" — Nest/Express's own
      // documented behavior (`SalaryStructuresController.get`'s own doc comment). supertest parses
      // that as `{}` since there's no JSON to decode; `res.text` (`''`) is the real signal.
      const res = await request(app.getHttpServer())
        .get(`/v1/payroll/salary-structures/${employee2Id}`)
        .set('Authorization', `Bearer ${readOnlyToken}`);
      expect(res.status).toBe(200);
      expect(res.text).toBe('');
    });

    it('403s a salary-structure write for a payroll.read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .put(`/v1/payroll/salary-structures/${employee2Id}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          basicSalary: 30000,
          housingAllowance: 2000,
          transportAllowance: 1000,
          otherAllowance: 500,
          taxDeduction: 1000,
          loanDeduction: 500,
          otherDeduction: 200,
        });
      expect(res.status).toBe(403);
    });

    it('sets the salary structure', async () => {
      const res = await request(app.getHttpServer())
        .put(`/v1/payroll/salary-structures/${employee2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          basicSalary: 30000,
          housingAllowance: 2000,
          transportAllowance: 1000,
          otherAllowance: 500,
          taxDeduction: 1000,
          loanDeduction: 500,
          otherDeduction: 200,
        });
      expect(res.status).toBe(200);
      expect(body<{ basicSalary: number }>(res).basicSalary).toBe(30000);
    });

    it('creates a draft payroll period', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/payroll/periods')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'April 2026',
          startDate: '2026-04-01',
          endDate: '2026-04-30',
        });
      expect(res.status).toBe(201);
      const created = body<{
        id: string;
        status: string;
        employeeCount: number;
      }>(res);
      expect(created.status).toBe('draft');
      expect(created.employeeCount).toBe(0);
      periodId = created.id;
    });

    it('runs the period — generates one payslip per active employee with a salary structure', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/payroll/periods/${periodId}/run`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(201);
      const period = body<{ status: string; employeeCount: number }>(res);
      expect(period.status).toBe('generated');
      // Only employee 2 is both active and has a salary structure — employee 1 resigned earlier.
      expect(period.employeeCount).toBe(1);
    });

    it('409s running an already-generated period again', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/payroll/periods/${periodId}/run`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('computes the PRD §20 breakdown correctly, visible via periodId before approval', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/payroll/payslips')
        .query({ page: 1, pageSize: 20, periodId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{
        items: Array<{
          id: string;
          employeeId: string;
          breakdown: Record<string, number>;
        }>;
      }>(res);
      expect(page.items).toHaveLength(1);
      const payslip = page.items[0];
      expect(payslip.employeeId).toBe(employee2Id);
      payslipId = payslip.id;
      // basic 30000 + allowances 3500 + 0 + 0 - tax 1000 - deductions 200 - absence 0 - loan 500
      expect(payslip.breakdown).toMatchObject({
        basicSalary: 30000,
        allowances: 3500,
        overtime: 0,
        bonus: 0,
        tax: 1000,
        deductions: 200,
        absenceDeduction: 0,
        loanDeduction: 500,
        netPay: 31800,
      });
    });

    it('employeeId=me sees nothing before the period is approved (publish gate)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/payroll/payslips')
        .query({ page: 1, pageSize: 20, employeeId: 'me' })
        .set('Authorization', `Bearer ${employee2Token}`);
      expect(res.status).toBe(200);
      expect(body<{ items: unknown[] }>(res).items).toHaveLength(0);
    });

    it('approves the period as a payroll.approve holder', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/payroll/periods/${periodId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(201);
      expect(body<{ status: string }>(res).status).toBe('approved');
    });

    it('employeeId=me now sees the published payslip', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/payroll/payslips')
        .query({ page: 1, pageSize: 20, employeeId: 'me' })
        .set('Authorization', `Bearer ${employee2Token}`);
      expect(res.status).toBe(200);
      const page = body<{ items: Array<{ id: string }> }>(res);
      expect(page.items.map((p) => p.id)).toContain(payslipId);
    });

    it('gets a single payslip by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/payroll/payslips/${payslipId}`)
        .set('Authorization', `Bearer ${employee2Token}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }>(res).id).toBe(payslipId);
    });
  });

  describe('Absence deduction — unpaid leave overlapping the payroll period', () => {
    it('deducts basicSalary/30 per approved unpaid-leave day inside the period', async () => {
      const leaveRes = await request(app.getHttpServer())
        .post('/v1/leave/employee')
        .set('Authorization', `Bearer ${employee2Token}`)
        .send({
          leaveType: 'unpaid',
          startDate: '2026-05-10',
          endDate: '2026-05-11',
          reason: 'Unpaid time off',
        });
      expect(leaveRes.status).toBe(201);
      const unpaidLeaveId = body<{ id: string }>(leaveRes).id;

      const approveRes = await request(app.getHttpServer())
        .patch(`/v1/leave/employee/${unpaidLeaveId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' });
      expect(approveRes.status).toBe(200);

      const periodRes = await request(app.getHttpServer())
        .post('/v1/payroll/periods')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          label: 'May 2026',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
        });
      const mayPeriodId = body<{ id: string }>(periodRes).id;

      const runRes = await request(app.getHttpServer())
        .post(`/v1/payroll/periods/${mayPeriodId}/run`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(runRes.status).toBe(201);

      const payslipsRes = await request(app.getHttpServer())
        .get('/v1/payroll/payslips')
        .query({ page: 1, pageSize: 20, periodId: mayPeriodId })
        .set('Authorization', `Bearer ${adminToken}`);
      const payslip = body<{
        items: Array<{ breakdown: Record<string, number> }>;
      }>(payslipsRes).items[0];
      // 30000 / 30 = 1000/day * 2 days = 2000.
      expect(payslip.breakdown.absenceDeduction).toBe(2000);
      expect(payslip.breakdown.netPay).toBe(31800 - 2000);
    });
  });

  describe('Tenant isolation', () => {
    it("a different tenant's caller sees no employees from tenant A", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/hr/employees')
        .query({ page: 1, pageSize: 50 })
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(200);
      const list = body<{ items: Array<{ id: string }> }>(res);
      expect(
        list.items.some((e) => e.id === employee1Id || e.id === employee2Id),
      ).toBe(false);
    });

    it("404s fetching tenant A's employee by id from tenant B", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/hr/employees/${employee1Id}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });
  });
});
