import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './common/config/app-config.module';
import { RequestContextModule } from './common/context/request-context.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Order matters: config first (everything else reads from it), then request context
    // (must be established before any guard runs), then Prisma/Redis (depend on both).
    AppConfigModule,
    RequestContextModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    // Phase 2+ feature modules mount here, in the order listed in
    // ../implementation-plan.md's phase table.
  ],
  providers: [
    // Rate limiting applies globally; individual auth endpoints (Phase 1) tighten this further
    // with their own stricter throttle per security-standards' "rate limiting on auth" guidance.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Verifies the access token and populates RequestContextService — must run before
    // PermissionsGuard, which reads the permission set that populates. `@Public()` routes
    // (health, login, refresh, forgot/reset-password) opt out explicitly.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Reads the permission set JwtAuthGuard just resolved from the verified token.
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
