import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { MailerService } from '../common/mailer/mailer.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformSettingsService } from './platform-settings.service';
import { addDaysPkt } from '../common/dates/pkt-time';

const OWNER_ADMIN_ROLE_KEYS = ['school_owner', 'school_admin'];

/**
 * Daily sweep implementing PRD item #3/#4's expiry → grace → auto-suspend lifecycle — the one
 * background job this codebase runs (see `system-health.service.ts`'s own "no job queue exists"
 * note; `@nestjs/schedule`'s in-process `@Cron` is enough for one daily pass over a subscriptions
 * table, no BullMQ/Redis queue needed). Runs at 00:15 `Asia/Karachi` daily — after
 * `pkt-time.ts`'s own PKT-midnight boundary, so "today's" expiries have actually rolled over.
 *
 * Both steps below are idempotent re-reads of the same `WHERE` clause: a subscription that's
 * already transitioned matches neither query again, so a missed or doubled-up run (a redeploy
 * mid-sweep, e.g.) is safe to just re-run.
 */
@Injectable()
export class SubscriptionSweepService {
  private readonly logger = new Logger(SubscriptionSweepService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly mailer: MailerService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  @Cron('0 15 0 * * *', { timeZone: 'Asia/Karachi' })
  async runSweep(): Promise<void> {
    await this.expireLapsedPeriods();
    await this.suspendLapsedGraceWindows();
  }

  private async expireLapsedPeriods(): Promise<void> {
    const now = new Date();
    const gracePeriodDays = await this.settings.getGracePeriodDays();
    const lapsed = await this.platformPrisma.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
      include: { tenant: { include: { school: true } } },
    });

    for (const subscription of lapsed) {
      const graceEndsAt = addDaysPkt(
        subscription.currentPeriodEnd,
        gracePeriodDays,
      );

      // This query only ever matches a subscription still `ACTIVE`, and the update below always
      // moves it to `GRACE` — so a given subscription is only ever picked up by this branch once
      // per lapsed period, and `lastReminderEmailAt` here is a plain "when was it sent" record,
      // not a dedupe check (a subscription already in `GRACE` never matches this query again).
      await this.platformPrisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'GRACE', graceEndsAt, lastReminderEmailAt: now },
      });

      const schoolName =
        subscription.tenant.school?.name ?? subscription.tenant.name;
      const recipients = await this.recipientsForTenant(subscription.tenantId);
      await this.notify(subscription.tenantId, recipients, {
        subject: `${schoolName}'s SchoolOS subscription has expired`,
        html: expiredEmail(schoolName, graceEndsAt),
        notificationTitle: 'Subscription expired',
        notificationBody: `Payment is due — you have until ${graceEndsAt.toDateString()} before access is suspended.`,
      });
      this.logger.log(
        `Subscription ${subscription.id} (${schoolName}) entered its grace window, ends ${graceEndsAt.toISOString()}`,
      );
    }
  }

  private async suspendLapsedGraceWindows(): Promise<void> {
    const now = new Date();
    const overdue = await this.platformPrisma.subscription.findMany({
      where: { status: 'GRACE', graceEndsAt: { lte: now } },
      include: { tenant: { include: { school: true } } },
    });

    for (const subscription of overdue) {
      const schoolName =
        subscription.tenant.school?.name ?? subscription.tenant.name;

      await this.platformPrisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'SUSPENDED' },
      });
      await this.platformPrisma.tenant.update({
        where: { id: subscription.tenantId },
        data: { status: 'SUSPENDED' },
      });
      await this.auditLog.record({
        action: 'subscription.auto_suspended',
        target: schoolName,
        tenantId: subscription.tenantId,
        tenantName: schoolName,
      });

      const recipients = await this.recipientsForTenant(subscription.tenantId);
      await this.notify(subscription.tenantId, recipients, {
        subject: `${schoolName}'s SchoolOS access has been suspended`,
        html: suspendedEmail(schoolName),
        notificationTitle: 'Subscription suspended',
        notificationBody:
          'Access is suspended until payment is confirmed by the Platform Admin.',
      });
      this.logger.warn(
        `Subscription ${subscription.id} (${schoolName}) auto-suspended — grace window lapsed unpaid`,
      );
    }
  }

  private async recipientsForTenant(
    tenantId: string,
  ): Promise<Array<{ id: string; email: string; name: string }>> {
    return this.platformPrisma.user.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        userRoles: { some: { role: { key: { in: OWNER_ADMIN_ROLE_KEYS } } } },
      },
      select: { id: true, email: true, name: true },
    });
  }

  private async notify(
    tenantId: string,
    recipients: Array<{ id: string; email: string; name: string }>,
    input: {
      subject: string;
      html: string;
      notificationTitle: string;
      notificationBody: string;
    },
  ): Promise<void> {
    for (const recipient of recipients) {
      await this.mailer.send({
        to: recipient.email,
        subject: input.subject,
        html: input.html,
      });
      await this.platformPrisma.notification.create({
        data: {
          tenantId,
          userId: recipient.id,
          type: 'billing',
          title: input.notificationTitle,
          body: input.notificationBody,
        },
      });
    }
  }
}

function expiredEmail(schoolName: string, graceEndsAt: Date): string {
  return `
    <p>Hi,</p>
    <p>${schoolName}'s SchoolOS subscription period has ended and payment hasn't been confirmed
    yet.</p>
    <p>You have until <strong>${graceEndsAt.toDateString()}</strong> to make payment before
    access is suspended.</p>
  `;
}

function suspendedEmail(schoolName: string): string {
  return `
    <p>Hi,</p>
    <p>${schoolName}'s SchoolOS access has been suspended — the payment grace period has
    lapsed with no payment confirmed. Access will be restored as soon as payment is confirmed.</p>
  `;
}
