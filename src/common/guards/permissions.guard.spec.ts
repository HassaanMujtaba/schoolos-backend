import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from './permissions.guard';
import { RequestContextService } from '../context/request-context.service';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows a route with no @RequirePermission metadata through', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const requestContext = new RequestContextService();
    const guard = new PermissionsGuard(reflector, requestContext);

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('allows the request when every required permission is granted', () => {
    const reflector = {
      getAllAndOverride: () => ['students.read'],
    } as unknown as Reflector;
    const requestContext = new RequestContextService();
    const guard = new PermissionsGuard(reflector, requestContext);

    const result = requestContext.run(
      {
        requestId: 'req-1',
        tenantId: 'tenant-1',
        branchId: null,
        userId: 'user-1',
        permissions: ['students.read', 'students.create'],
      },
      () => guard.canActivate(makeContext()),
    );

    expect(result).toBe(true);
  });

  it(
    'throws ForbiddenException (403) when a required permission is missing — this is the ' +
      "backend's own version of a permission-denied response, matching the frontend's " +
      'RequirePermission gating',
    () => {
      const reflector = {
        getAllAndOverride: () => ['fees.refund'],
      } as unknown as Reflector;
      const requestContext = new RequestContextService();
      const guard = new PermissionsGuard(reflector, requestContext);

      expect(() =>
        requestContext.run(
          {
            requestId: 'req-2',
            tenantId: 'tenant-1',
            branchId: null,
            userId: 'user-1',
            permissions: ['fees.read'],
          },
          () => guard.canActivate(makeContext()),
        ),
      ).toThrow(ForbiddenException);
    },
  );

  it('requires ALL listed permissions, not any one of them', () => {
    const reflector = {
      getAllAndOverride: () => ['fees.read', 'fees.refund'],
    } as unknown as Reflector;
    const requestContext = new RequestContextService();
    const guard = new PermissionsGuard(reflector, requestContext);

    expect(() =>
      requestContext.run(
        {
          requestId: 'req-3',
          tenantId: 'tenant-1',
          branchId: null,
          userId: 'user-1',
          permissions: ['fees.read'],
        },
        () => guard.canActivate(makeContext()),
      ),
    ).toThrow(ForbiddenException);
  });
});
