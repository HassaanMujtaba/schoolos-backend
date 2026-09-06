import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';

/**
 * `tenant-scoping.spec.ts`'s own "runAsPlatform bypasses per-tenant scoping deliberately" test
 * documents that `RequestContextService.runAsPlatform()` does **not** make `PrismaService`
 * queries unscoped — a tenant-scoped model still throws with no `tenantId` in context, on
 * purpose, because "a cross-tenant read must go through an explicitly platform-scoped
 * model/query, not this per-tenant path at all." This class is that explicit path: a second,
 * deliberately *un*-extended Prisma client (no `applyTenantScoping` hook), separate from
 * `PrismaService`'s tenant-scoped one.
 *
 * Two sanctioned call sites:
 * 1. `users/users.service.ts`'s auth-profile lookups, used only by `auth/`'s own pre-tenant-
 *    context reads: resolving a login identifier to a user (tenant isn't known until *after* it
 *    resolves to a row) and re-syncing a user's roles/permissions by id on refresh (the request
 *    context at that point carries the session's userId but deliberately isn't put through the
 *    normal auth guard, so no per-request tenant context exists to scope through yet either).
 * 2. Phase 7.9 Platform Console (PRD §54) — the one module that legitimately reads across every
 *    tenant, gated on `platform.*` permissions rather than tenant membership.
 *
 * Treat a new call site for this class the way `security-standards` treats `runAsPlatform()`:
 * real, unfiltered cross-tenant access, worth a second look in review — never reach for it just
 * because a tenant-scoped query is inconvenient to satisfy.
 */
@Injectable()
export class PlatformPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: AppConfigService) {
    super({
      datasources: { db: { url: config.databaseUrl } },
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
