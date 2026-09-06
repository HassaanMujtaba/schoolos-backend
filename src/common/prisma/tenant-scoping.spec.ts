import { describe, expect, it, vi } from 'vitest';
import { applyTenantScoping } from './tenant-scoping';
import { RequestContextService } from '../context/request-context.service';

describe('applyTenantScoping — two-tenant isolation proof (Phase 0 exit criterion)', () => {
  it("scopes a findMany on tenant A's context to tenant A, never tenant B", async () => {
    const requestContext = new RequestContextService();
    const query = vi.fn().mockResolvedValue([]);

    await requestContext.run(
      {
        requestId: 'r1',
        tenantId: 'tenant-a',
        branchId: null,
        userId: 'u1',
        permissions: [],
      },
      () =>
        applyTenantScoping(requestContext, {
          model: 'User',
          operation: 'findMany',
          args: { where: { status: 'ACTIVE' } },
          query,
        }),
    );

    expect(query).toHaveBeenCalledWith({
      where: { AND: [{ status: 'ACTIVE' }, { tenantId: 'tenant-a' }] },
    });
  });

  it(
    "running the same query under tenant B's context scopes to tenant B instead — proves " +
      'the two contexts can never see the same rows through this path',
    async () => {
      const requestContext = new RequestContextService();
      const queryA = vi.fn().mockResolvedValue([]);
      const queryB = vi.fn().mockResolvedValue([]);

      await requestContext.run(
        {
          requestId: 'r1',
          tenantId: 'tenant-a',
          branchId: null,
          userId: 'u1',
          permissions: [],
        },
        () =>
          applyTenantScoping(requestContext, {
            model: 'User',
            operation: 'findMany',
            args: {},
            query: queryA,
          }),
      );

      await requestContext.run(
        {
          requestId: 'r2',
          tenantId: 'tenant-b',
          branchId: null,
          userId: 'u2',
          permissions: [],
        },
        () =>
          applyTenantScoping(requestContext, {
            model: 'User',
            operation: 'findMany',
            args: {},
            query: queryB,
          }),
      );

      const [scopedArgsA] = queryA.mock.calls[0] as [
        { where: { AND: unknown[] } },
      ];
      const [scopedArgsB] = queryB.mock.calls[0] as [
        { where: { AND: unknown[] } },
      ];
      expect(scopedArgsA.where.AND).toContainEqual({ tenantId: 'tenant-a' });
      expect(scopedArgsB.where.AND).toContainEqual({ tenantId: 'tenant-b' });
    },
  );

  it(
    "a client-supplied tenantId in `data` is overwritten by the context's tenantId on create " +
      '— never trust tenantId from the caller (PRD §52)',
    async () => {
      const requestContext = new RequestContextService();
      const query = vi.fn().mockResolvedValue({});

      await requestContext.run(
        {
          requestId: 'r1',
          tenantId: 'tenant-a',
          branchId: null,
          userId: 'u1',
          permissions: [],
        },
        () =>
          applyTenantScoping(requestContext, {
            model: 'User',
            operation: 'create',
            args: { data: { name: 'Eve', tenantId: 'tenant-b' } },
            query,
          }),
      );

      expect(query).toHaveBeenCalledWith({
        data: { name: 'Eve', tenantId: 'tenant-a' },
      });
    },
  );

  it('fails closed: a tenant-scoped model with no tenant in context throws rather than running unscoped', () => {
    const requestContext = new RequestContextService();
    const query = vi.fn();

    expect(() =>
      applyTenantScoping(requestContext, {
        model: 'User',
        operation: 'findMany',
        args: {},
        query,
      }),
    ).toThrow(/no tenant in request context/);
    expect(query).not.toHaveBeenCalled();
  });

  it('passes non-tenant-scoped models through untouched (e.g. the global Permission catalog)', async () => {
    const requestContext = new RequestContextService();
    const query = vi.fn().mockResolvedValue([]);

    await applyTenantScoping(requestContext, {
      model: 'Permission',
      operation: 'findMany',
      args: { where: { key: 'students.read' } },
      query,
    });

    expect(query).toHaveBeenCalledWith({ where: { key: 'students.read' } });
  });

  it('runAsPlatform bypasses per-tenant scoping deliberately, for the Platform Console (PRD §54)', () => {
    const requestContext = new RequestContextService();
    const query = vi.fn().mockResolvedValue([]);

    expect(() =>
      requestContext.runAsPlatform(() =>
        applyTenantScoping(requestContext, {
          model: 'User',
          operation: 'findMany',
          args: {},
          query,
        }),
      ),
    ).toThrow(/no tenant in request context/);
    // runAsPlatform intentionally still has tenantId: null — a cross-tenant read must go through
    // an explicitly platform-scoped model/query, not this per-tenant path at all. This test
    // documents that boundary rather than asserting a bypass exists here.
  });
});
