import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { SubscriptionSweepService } from './subscription-sweep.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';
import { AuditLogController } from './audit-log.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * `modules/platform-console.md` (Phase 7.9) — Super Admin only, genuinely cross-tenant. Imports
 * `AuthModule` for `SchoolsService`'s use of `AuthService.issueInviteToken` (onboarding a school
 * creates its first Owner as `INVITED`, same cross-module-reuse pattern
 * `AdmissionsModule`→`FeesModule`/`PayrollModule`→`HrModule` already establish). Everything else
 * this module needs (`PlatformPrismaService`, `PrismaService`, `RedisService`, `StorageService`,
 * `MailerService`) is `@Global()`, so no further imports are needed for those.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    SchoolsController,
    SubscriptionsController,
    BillingController,
    PlatformSettingsController,
    PlatformUsersController,
    FeatureFlagsController,
    UsageController,
    SystemHealthController,
    AuditLogController,
    RolesController,
  ],
  providers: [
    PlatformAuditLogService,
    SchoolsService,
    SubscriptionsService,
    BillingService,
    PlatformSettingsService,
    SubscriptionSweepService,
    PlatformUsersService,
    FeatureFlagsService,
    UsageService,
    SystemHealthService,
    RolesService,
  ],
})
export class PlatformModule {}
