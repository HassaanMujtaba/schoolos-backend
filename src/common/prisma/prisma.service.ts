import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { RequestContextService } from '../context/request-context.service';
import { applyTenantScoping } from './tenant-scoping';

/**
 * PRD §3 / §52 / security-standards: "every tenant-owned record must be securely scoped to the
 * tenant... tenant isolation must be enforced at the service/repository level and never rely
 * only on frontend filtering." The actual scoping logic lives in `applyTenantScoping`
 * (`tenant-scoping.ts`, unit-tested independently of any live database); this class just wires
 * it into Prisma's `$extends()` query hook and manages the connection lifecycle.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    config: AppConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    super({
      datasources: { db: { url: config.databaseUrl } },
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });

    // Returned in place of `this` so every consumer that injects `PrismaService` gets the
    // tenant-scoped client automatically — there is no "remember to use the scoped client" step
    // for feature modules to get wrong.
    return this.withTenantScoping();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private withTenantScoping() {
    const requestContext = this.requestContext;

    return this.$extends({
      query: {
        $allModels: {
          $allOperations: (params) =>
            applyTenantScoping(requestContext, params),
        },
      },
    }) as unknown as PrismaService;
  }
}
