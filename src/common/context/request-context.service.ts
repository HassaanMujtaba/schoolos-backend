import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  /** Resolved server-side from the validated access token — never from a client-supplied field. */
  tenantId: string | null;
  branchId: string | null;
  userId: string | null;
  permissions: string[];
  ip?: string;
}

/**
 * Carries the authenticated request's tenant/user/permission context across the async call
 * chain so `PrismaService` can scope every query without every service method threading
 * `tenantId` through by hand. Populated once per request by `TenantContextGuard` (Phase 1's auth
 * guard) from the *validated JWT*, per PRD §52 / security-standards: "never trust tenantId from
 * the client."
 *
 * Phase 0 note: nothing populates this yet outside of tests — the real population happens once
 * `AuthModule` (Phase 1) issues and verifies tokens. Until then, `PrismaService` treats a missing
 * context as "no tenant" and every tenant-scoped query returns nothing, fail-closed rather than
 * fail-open.
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  get current(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  /**
   * Mutates the *current* async-context store in place (rather than opening a new `run()`), so a
   * later middleware/guard in the same request chain — e.g. the auth guard resolving tenant/user
   * from a verified token — can enrich the context the request-id middleware already opened,
   * without needing to re-wrap every downstream handler in a second `run()` call.
   */
  patch(partial: Partial<Omit<RequestContextStore, 'requestId'>>): void {
    const store = this.current;
    if (!store) return;
    Object.assign(store, partial);
  }

  get tenantId(): string | null {
    return this.current?.tenantId ?? null;
  }

  get userId(): string | null {
    return this.current?.userId ?? null;
  }

  get permissions(): string[] {
    return this.current?.permissions ?? [];
  }

  /**
   * Escape hatch for platform-console-style cross-tenant queries (PRD §54) and for background
   * jobs that legitimately have no request-scoped tenant. Callers must be explicit about it —
   * there is no implicit "no context means unscoped" behavior anywhere else in `PrismaService`.
   */
  runAsPlatform<T>(callback: () => T): T {
    return this.storage.run(
      {
        requestId: 'platform',
        tenantId: null,
        branchId: null,
        userId: null,
        permissions: ['platform.*'],
      },
      callback,
    );
  }
}
