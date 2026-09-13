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

const INVENTORY_PERMISSIONS = ['inventory.read', 'inventory.manage'];
const INVENTORY_READ_ONLY = ['inventory.read'];
const ASSETS_PERMISSIONS = ['assets.read', 'assets.manage'];
const ASSETS_READ_ONLY = ['assets.read'];

/**
 * Requires a real Postgres + Redis (see `test/health.e2e-spec.ts`'s own header comment) —
 * `../implementation-plan.md`'s Phase 7.4 exit test: `frontend/src/features/inventory/api.ts`'s
 * assumed shapes hitting the real endpoints — stock category CRUD, stock item CRUD with
 * server-ignored `quantity` on update, the movement log applying a signed delta and rejecting a
 * negative result, asset CRUD with wholesale-replaced maintenance records and the
 * disposed-without-a-disposal-date 400, and tenant/permission isolation for both resources
 * (`inventory.*` and `assets.*` are separate permission pairs, matching the module doc's own
 * catalog).
 */
describe('Inventory & Assets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PlatformPrismaService;

  let tenantAId: string;
  let tenantBId: string;
  let adminToken: string;
  let inventoryReadOnlyToken: string;
  let assetsReadOnlyToken: string;
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
    const email = `inventory-e2e-${randomUUID()}@example.test`;
    const roleKey = `inventory_e2e_role_${randomUUID()}`;
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
        name: 'Inventory E2E Tenant A',
        slug: `iea-${tenantAId}`,
      },
    });
    await prisma.tenant.create({
      data: {
        id: tenantBId,
        name: 'Inventory E2E Tenant B',
        slug: `ieb-${tenantBId}`,
      },
    });

    const adminEmail = await createUserWithPermissions(
      tenantAId,
      [...INVENTORY_PERMISSIONS, ...ASSETS_PERMISSIONS],
      'Inventory Admin',
    );
    const inventoryReadOnlyEmail = await createUserWithPermissions(
      tenantAId,
      INVENTORY_READ_ONLY,
    );
    const assetsReadOnlyEmail = await createUserWithPermissions(
      tenantAId,
      ASSETS_READ_ONLY,
    );
    const tenantBEmail = await createUserWithPermissions(tenantBId, [
      ...INVENTORY_PERMISSIONS,
      ...ASSETS_PERMISSIONS,
    ]);

    adminToken = await loginAs(adminEmail);
    inventoryReadOnlyToken = await loginAs(inventoryReadOnlyEmail);
    assetsReadOnlyToken = await loginAs(assetsReadOnlyEmail);
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

  describe('Stock', () => {
    let categoryId: string;
    let stockItemId: string;

    it('403s creating a category for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/inventory/stock-categories')
        .set('Authorization', `Bearer ${inventoryReadOnlyToken}`)
        .send({ name: 'Stationery' });
      expect(res.status).toBe(403);
    });

    it('creates a stock category', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/inventory/stock-categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Stationery' });
      expect(res.status).toBe(201);
      const category = body<{ id: string; name: string }>(res);
      expect(category.name).toBe('Stationery');
      categoryId = category.id;
    });

    it('lists categories including the created one', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/inventory/stock-categories')
        .set('Authorization', `Bearer ${inventoryReadOnlyToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }[]>(res).some((c) => c.id === categoryId)).toBe(
        true,
      );
    });

    it('400s creating a stock item against a nonexistent category', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/inventory/stock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A4 Paper',
          categoryId: randomUUID(),
          unit: 'ream',
          quantity: 50,
          lowStockThreshold: 10,
          notes: '',
        });
      expect(res.status).toBe(400);
    });

    it('creates a stock item', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/inventory/stock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A4 Paper',
          categoryId,
          unit: 'ream',
          quantity: 50,
          lowStockThreshold: 10,
          unitCost: 3.5,
          notes: 'Standard copier paper',
        });
      expect(res.status).toBe(201);
      const item = body<{ id: string; quantity: number }>(res);
      expect(item.quantity).toBe(50);
      stockItemId = item.id;
    });

    it('lists stock items filtered by category', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/inventory/stock')
        .query({ page: 1, pageSize: 20, categoryId })
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[]; total: number }>(res);
      expect(page.items.some((i) => i.id === stockItemId)).toBe(true);
    });

    it("ignores a client-supplied quantity on update — it isn't the authoritative path", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/inventory/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A4 Paper (Premium)',
          categoryId,
          unit: 'ream',
          quantity: 999,
          lowStockThreshold: 15,
          notes: 'Upgraded to premium stock',
        });
      expect(res.status).toBe(200);
      const item = body<{ name: string; quantity: number }>(res);
      expect(item.name).toBe('A4 Paper (Premium)');
      expect(item.quantity).toBe(50);
    });

    it('403s logging a movement for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/inventory/stock/${stockItemId}/movements`)
        .set('Authorization', `Bearer ${inventoryReadOnlyToken}`)
        .send({
          type: 'restock',
          quantityChange: 10,
          issuedTo: '',
          reason: '',
          date: '2026-02-01',
        });
      expect(res.status).toBe(403);
    });

    it('logs a restock movement and increases quantity', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/inventory/stock/${stockItemId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'restock',
          quantityChange: 20,
          issuedTo: '',
          reason: 'Vendor delivery',
          date: '2026-02-01',
        });
      expect(res.status).toBe(201);
      expect(body<{ quantity: number }>(res).quantity).toBe(70);
    });

    it('logs an issue movement (negative delta) and decreases quantity', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/inventory/stock/${stockItemId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'issue',
          quantityChange: -30,
          issuedTo: 'Front office',
          reason: 'Monthly issue',
          date: '2026-02-05',
        });
      expect(res.status).toBe(201);
      expect(body<{ quantity: number }>(res).quantity).toBe(40);
    });

    it('400s a movement that would take quantity negative', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/inventory/stock/${stockItemId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'issue',
          quantityChange: -1000,
          issuedTo: 'Front office',
          reason: '',
          date: '2026-02-06',
        });
      expect(res.status).toBe(400);
    });

    it('400s a zero-quantity movement', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/inventory/stock/${stockItemId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'adjustment',
          quantityChange: 0,
          issuedTo: '',
          reason: '',
          date: '2026-02-06',
        });
      expect(res.status).toBe(400);
    });

    it('lists movements most-recent-first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/inventory/stock/${stockItemId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const movements = body<{ date: string; quantityChange: number }[]>(res);
      expect(movements).toHaveLength(2);
      expect(movements[0].date).toBe('2026-02-05');
      expect(movements[1].date).toBe('2026-02-01');
    });

    it('404s a cross-tenant stock item get via list', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/inventory/stock')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((i) => i.id === stockItemId)).toBe(false);
    });

    it('403s deleting a stock item for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/inventory/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${inventoryReadOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('deletes the stock item', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/inventory/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });

    it('deletes the category', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/inventory/stock-categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);
    });
  });

  describe('Assets', () => {
    let assetId: string;

    const assetPayload = {
      assetCode: 'AST-001',
      name: 'Dell Laptop',
      category: 'computer',
      status: 'in-use',
      purchaseDate: '2025-01-15',
      purchaseCost: 1200,
      usefulLifeYears: 4,
      location: 'IT Lab',
      assignedTo: 'Jane Teacher',
      warrantyExpiryDate: '2027-01-15',
      maintenanceRecords: [
        { date: '2026-01-10', description: 'RAM upgrade', cost: 60 },
      ],
      disposalDate: '',
      disposalReason: '',
    };

    it('403s creating an asset for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/assets')
        .set('Authorization', `Bearer ${assetsReadOnlyToken}`)
        .send(assetPayload);
      expect(res.status).toBe(403);
    });

    it("400s a 'disposed' status with no disposal date", async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/assets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...assetPayload, status: 'disposed' });
      expect(res.status).toBe(400);
    });

    it('creates an asset with a nested maintenance record', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/assets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(assetPayload);
      expect(res.status).toBe(201);
      const asset = body<{
        id: string;
        status: string;
        warrantyExpiryDate: string;
        maintenanceRecords: { description: string }[];
      }>(res);
      expect(asset.status).toBe('in-use');
      expect(asset.warrantyExpiryDate).toBe('2027-01-15');
      expect(asset.maintenanceRecords).toHaveLength(1);
      assetId = asset.id;
    });

    it('lists assets including the created one', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/assets')
        .query({ page: 1, pageSize: 20 })
        .set('Authorization', `Bearer ${assetsReadOnlyToken}`);
      expect(res.status).toBe(200);
      const page = body<{ items: { id: string }[] }>(res);
      expect(page.items.some((a) => a.id === assetId)).toBe(true);
    });

    it('gets an asset by id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/assets/${assetId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(body<{ id: string }>(res).id).toBe(assetId);
    });

    it('404s a cross-tenant asset get', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/assets/${assetId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);
      expect(res.status).toBe(404);
    });

    it('replaces maintenance records wholesale and disposes the asset on update', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/assets/${assetId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...assetPayload,
          status: 'disposed',
          disposalDate: '2026-03-01',
          disposalReason: 'End of life',
          disposalValue: 100,
          maintenanceRecords: [
            {
              date: '2026-02-01',
              description: 'Screen replacement',
              cost: 150,
            },
          ],
        });
      expect(res.status).toBe(200);
      const asset = body<{
        status: string;
        disposalDate: string;
        maintenanceRecords: { description: string }[];
      }>(res);
      expect(asset.status).toBe('disposed');
      expect(asset.disposalDate).toBe('2026-03-01');
      expect(asset.maintenanceRecords).toHaveLength(1);
      expect(asset.maintenanceRecords[0].description).toBe(
        'Screen replacement',
      );
    });

    it('403s deleting an asset for a read-only caller', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/assets/${assetId}`)
        .set('Authorization', `Bearer ${assetsReadOnlyToken}`);
      expect(res.status).toBe(403);
    });

    it('deletes the asset', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/assets/${assetId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(204);

      const get = await request(app.getHttpServer())
        .get(`/v1/assets/${assetId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(get.status).toBe(404);
    });
  });
});
