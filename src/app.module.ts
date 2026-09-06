import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './common/config/app-config.module';
import { RequestContextModule } from './common/context/request-context.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Order matters: config first (everything else reads from it), then request context
    // (must be established before any guard runs), then Prisma (depends on both).
    AppConfigModule,
    RequestContextModule,
    PrismaModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    HealthModule,
    // Phase 1+ feature modules mount here, in the order listed in
    // ../implementation-plan.md's phase table — AuthModule first.
  ],
  providers: [
    // Rate limiting applies globally; individual auth endpoints (Phase 1) tighten this further
    // with their own stricter throttle per security-standards' "rate limiting on auth" guidance.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // PermissionsGuard runs after Phase 1's JwtAuthGuard populates request context — registered
    // here now so every later feature module's @RequirePermission() is enforced from day one,
    // even though nothing can be granted a permission until Phase 1 exists.
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
