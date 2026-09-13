import { Module } from '@nestjs/common';
import { AppConfigService } from '../common/config/app-config.service';
import { AuthModule } from '../auth/auth.module';
import {
  BILLING_PROVIDER,
  LocalBillingProvider,
  StripeBillingProvider,
} from './billing-provider';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingService } from './billing.service';
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
 * creates its first admin as `INVITED`, same cross-module-reuse pattern
 * `AdmissionsModule`→`FeesModule`/`PayrollModule`→`HrModule` already establish). Everything else
 * this module needs (`PlatformPrismaService`, `PrismaService`, `RedisService`, `StorageService`)
 * is `@Global()`, so no further imports are needed for those.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    SchoolsController,
    PlansController,
    SubscriptionsController,
    BillingController,
    BillingWebhookController,
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
    PlansService,
    SubscriptionsService,
    BillingService,
    PlatformUsersService,
    FeatureFlagsService,
    UsageService,
    SystemHealthService,
    RolesService,
    LocalBillingProvider,
    StripeBillingProvider,
    {
      // `STRIPE_SECRET_KEY` present → the real integration; absent → the honest local stand-in.
      // See `billing-provider.ts`'s own doc comments on both.
      provide: BILLING_PROVIDER,
      useFactory: (
        config: AppConfigService,
        stripe: StripeBillingProvider,
        local: LocalBillingProvider,
      ) => (config.stripeSecretKey ? stripe : local),
      inject: [AppConfigService, StripeBillingProvider, LocalBillingProvider],
    },
  ],
})
export class PlatformModule {}
