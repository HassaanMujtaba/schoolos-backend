import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { lowerEnum } from './platform.mappers';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { BillingRecordResponseDto } from './dto/billing-record.dto';

const BILLING_RECORD_INCLUDE = {
  subscription: { include: { tenant: { include: { school: true } } } },
} satisfies Prisma.BillingRecordInclude;

type BillingRecordWithRelations = Prisma.BillingRecordGetPayload<{
  include: typeof BILLING_RECORD_INCLUDE;
}>;

function periodLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * `GET /platform/billing` plus the Stripe webhook that actually keeps `BillingRecord` current
 * (`billing-webhook.controller.ts`) — not part of `modules/platform-console.md`'s own endpoint
 * list (the frontend never calls a webhook route directly), but the "billing integration
 * underneath the CRUD" `../implementation-plan.md`'s Phase 7.9 section calls out as this phase's
 * real scope.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditLog: PlatformAuditLogService,
    private readonly config: AppConfigService,
  ) {}

  async list(
    query: ListQueryDto,
  ): Promise<PagedResult<BillingRecordResponseDto>> {
    const where: Prisma.BillingRecordWhereInput = query.search
      ? {
          subscription: {
            tenant: {
              school: { name: { contains: query.search, mode: 'insensitive' } },
            },
          },
        }
      : {};
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.platformPrisma.billingRecord.findMany({
          where,
          include: BILLING_RECORD_INCLUDE,
          orderBy: { issuedAt: query.sortDir ?? 'desc' },
          skip,
          take,
        }),
      () => this.platformPrisma.billingRecord.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  /**
   * `LocalBillingProvider` never fires a webhook (there's no real invoicing engine behind it), so
   * `SchoolsService.create`/`SubscriptionsService.create` call this directly right after
   * provisioning a subscription so `BillingTable` isn't empty for every tenant forever under local
   * mode. A real `StripeBillingProvider` subscription gets its first record the same way *and*
   * every later one from `handleStripeWebhook` below — `providerInvoiceId: null` here (there is no
   * real invoice id yet at provisioning time even under Stripe; the trial period's first real
   * invoice arrives later as its own webhook event).
   */
  async recordFirstPeriod(input: {
    tenantId: string;
    subscriptionId: string;
    amount: number;
    issuedAt: Date;
  }): Promise<void> {
    await this.platformPrisma.billingRecord.create({
      data: {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        periodLabel: periodLabel(input.issuedAt),
        amount: input.amount,
        status: 'PENDING',
        issuedAt: input.issuedAt,
      },
    });
  }

  /**
   * Verifies the Stripe signature (never trust an unverified webhook body — `security-standards`'
   * "never trust client input" applies just as much to a POST claiming to be Stripe) and syncs
   * `invoice.paid`/`invoice.payment_failed`/`customer.subscription.deleted` onto
   * `BillingRecord`/`Subscription`. Every other Stripe event type is acknowledged and ignored —
   * Stripe's own guidance is to 200 on events you don't handle rather than error, so a dashboard
   * webhook-delivery view doesn't fill up with false failures.
   */
  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.config.stripeWebhookSecret;
    if (!webhookSecret || !this.config.stripeSecretKey) {
      throw new BadRequestException('Stripe billing is not configured');
    }
    const stripe = new Stripe(this.config.stripeSecretKey);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      throw new BadRequestException(
        `Invalid Stripe webhook signature: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    switch (event.type) {
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await this.syncInvoice(event.data.object, event.type);
        break;
      case 'customer.subscription.deleted':
        await this.syncSubscriptionCanceled(event.data.object);
        break;
      default:
        this.logger.log(`Ignoring unhandled Stripe event type: ${event.type}`);
    }
  }

  private async syncInvoice(
    invoice: Stripe.Invoice,
    eventType: 'invoice.paid' | 'invoice.payment_failed',
  ): Promise<void> {
    const stripeSubscriptionId =
      typeof invoice.parent?.subscription_details?.subscription === 'string'
        ? invoice.parent.subscription_details.subscription
        : null;
    if (!stripeSubscriptionId) {
      this.logger.warn(
        `Stripe invoice ${invoice.id} has no subscription — skipping`,
      );
      return;
    }
    const subscription = await this.platformPrisma.subscription.findUnique({
      where: { stripeSubscriptionId },
      include: { tenant: { include: { school: true } } },
    });
    if (!subscription) {
      this.logger.warn(
        `Stripe invoice ${invoice.id} references unknown subscription ${stripeSubscriptionId}`,
      );
      return;
    }
    const tenantName =
      subscription.tenant.school?.name ?? subscription.tenant.name;

    const status = eventType === 'invoice.paid' ? 'PAID' : 'FAILED';
    await this.platformPrisma.billingRecord.upsert({
      where: { providerInvoiceId: invoice.id },
      create: {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        periodLabel: periodLabel(new Date(invoice.created * 1000)),
        amount: invoice.amount_paid / 100,
        status,
        issuedAt: new Date(invoice.created * 1000),
        paidAt: status === 'PAID' ? new Date() : null,
        providerInvoiceId: invoice.id,
        invoiceUrl: invoice.hosted_invoice_url ?? null,
      },
      update: {
        status,
        paidAt: status === 'PAID' ? new Date() : null,
        invoiceUrl: invoice.hosted_invoice_url ?? null,
      },
    });

    if (eventType === 'invoice.payment_failed') {
      await this.platformPrisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'PAST_DUE' },
      });
    }

    // A financially significant event either way (PRD §43/§54's platform-level audit trail) —
    // every other subscription-affecting webhook event (`syncSubscriptionCanceled` below) logs
    // one too, this shouldn't be the exception.
    await this.auditLog.record({
      action: `billing.${eventType === 'invoice.paid' ? 'invoice_paid' : 'invoice_payment_failed'}:stripe-webhook`,
      target: tenantName,
      tenantId: subscription.tenantId,
      tenantName,
    });
  }

  private async syncSubscriptionCanceled(
    stripeSubscription: Stripe.Subscription,
  ): Promise<void> {
    const subscription = await this.platformPrisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubscription.id },
      include: { tenant: { include: { school: true } } },
    });
    if (!subscription) return;

    await this.platformPrisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELED' },
    });
    await this.auditLog.record({
      action: 'subscription.canceled:stripe-webhook',
      target: subscription.tenant.school?.name ?? subscription.tenant.name,
      tenantId: subscription.tenantId,
      tenantName: subscription.tenant.school?.name ?? subscription.tenant.name,
    });
  }
}

function toResponse(
  record: BillingRecordWithRelations,
): BillingRecordResponseDto {
  return {
    id: record.id,
    tenantId: record.tenantId,
    tenantName:
      record.subscription.tenant.school?.name ??
      record.subscription.tenant.name,
    periodLabel: record.periodLabel,
    amount: record.amount,
    status: lowerEnum(record.status),
    issuedAt: record.issuedAt.toISOString(),
  };
}
