import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Stripe from 'stripe';
import { Plan, Subscription } from '@prisma/client';
import { AppConfigService } from '../common/config/app-config.service';

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProvisionedSubscription {
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
}

/**
 * `implementation-plan.md`'s own framing for this phase: "this phase's biggest scope item isn't
 * the CRUD, it's the billing integration underneath it." This interface is that integration,
 * abstracted the same way `certificates/pdf` abstracts template rendering — `PlatformModule`
 * (`platform.module.ts`) wires `StripeBillingProvider` when `STRIPE_SECRET_KEY` is configured,
 * `LocalBillingProvider` otherwise. Every `platform/*.service.ts` calls this interface, never
 * `Stripe` directly — no call site needs to know which one is live.
 */
export interface BillingProvider {
  readonly kind: 'stripe' | 'local';

  provisionSubscription(input: {
    tenantName: string;
    contactEmail: string;
    plan: Plan;
  }): Promise<ProvisionedSubscription>;

  /** Moves an existing subscription onto a different plan/tier, effective immediately. */
  changePlan(subscription: Subscription, plan: Plan): Promise<void>;

  /** `cancelAtPeriodEnd: true` per Stripe's own default cancellation semantics — a school keeps
   * access through what it already paid for, per PRD §53's billing fairness expectation; nothing
   * currently exposes an immediate/hard cancel. */
  cancelSubscription(subscription: Subscription): Promise<void>;
}

/**
 * The real integration. Requires every `Plan` row it's asked to subscribe against to carry a real
 * `stripePriceId` (`schema.prisma`'s own doc comment on that column) — fails loudly with a config
 * error rather than a confusing raw Stripe API error if one's missing.
 *
 * Not exercised against live Stripe in this environment (no test-mode API key configured here —
 * see `env.validation.ts`'s own note) — reviewed against the `stripe` Node SDK v22 API shape, not
 * verified end-to-end. Verify with a real Stripe test-mode key before relying on this in staging,
 * same caveat Phase 0's own status note gives its unverified-against-a-live-DB scaffolding.
 */
@Injectable()
export class StripeBillingProvider implements BillingProvider {
  readonly kind = 'stripe' as const;
  private clientInstance: Stripe | undefined;

  constructor(private readonly config: AppConfigService) {
    // Deliberately does *not* construct a `Stripe` client or throw here — `PlatformModule`
    // registers this provider unconditionally (see its own comment) so Nest's normal eager
    // provider instantiation doesn't crash every boot that has no `STRIPE_SECRET_KEY` configured
    // (which, per `env.validation.ts`, is the common/local/CI case). `client` below is the actual
    // "fail if unconfigured" gate, checked only when a method is actually called — i.e. only when
    // `PlatformModule`'s factory picked this class as the live provider.
  }

  private get client(): Stripe {
    if (!this.clientInstance) {
      const secretKey = this.config.stripeSecretKey;
      if (!secretKey) {
        // Unreachable via `PlatformModule`'s own factory (it only ever hands this class to a
        // caller when `stripeSecretKey` is set) — guarded again here so a future call site can't
        // silently use an unconfigured client if that wiring ever changes.
        throw new InternalServerErrorException(
          'StripeBillingProvider used with no STRIPE_SECRET_KEY configured',
        );
      }
      this.clientInstance = new Stripe(secretKey);
    }
    return this.clientInstance;
  }

  async provisionSubscription(input: {
    tenantName: string;
    contactEmail: string;
    plan: Plan;
  }): Promise<ProvisionedSubscription> {
    const priceId = this.requirePriceId(input.plan);

    const customer = await this.client.customers.create({
      name: input.tenantName,
      email: input.contactEmail,
    });

    const subscription = await this.client.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: TRIAL_DAYS,
      payment_behavior: 'default_incomplete',
    });

    const item = subscription.items.data[0];
    return {
      providerCustomerId: customer.id,
      providerSubscriptionId: subscription.id,
      currentPeriodStart: new Date(item.current_period_start * 1000),
      currentPeriodEnd: new Date(item.current_period_end * 1000),
      trialEndsAt: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
    };
  }

  async changePlan(subscription: Subscription, plan: Plan): Promise<void> {
    if (!subscription.stripeSubscriptionId) {
      throw new InternalServerErrorException(
        `Subscription ${subscription.id} has no stripeSubscriptionId — cannot change plan via Stripe`,
      );
    }
    const priceId = this.requirePriceId(plan);
    const existing = await this.client.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
    );
    const itemId = existing.items.data[0]?.id;
    await this.client.subscriptions.update(subscription.stripeSubscriptionId, {
      items: itemId ? [{ id: itemId, price: priceId }] : [{ price: priceId }],
      proration_behavior: 'create_prorations',
    });
  }

  async cancelSubscription(subscription: Subscription): Promise<void> {
    if (!subscription.stripeSubscriptionId) return;
    await this.client.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  private requirePriceId(plan: Plan): string {
    if (!plan.stripePriceId) {
      throw new InternalServerErrorException(
        `Plan ${plan.tier} has no stripePriceId configured — set one before subscribing a ` +
          'tenant to it under a live Stripe provider',
      );
    }
    return plan.stripePriceId;
  }
}

/**
 * Dev/CI/self-hosted stand-in — real, not faked (`env.validation.ts`'s own comment): produces
 * deterministic, database-only subscription lifecycles with no network call, the same "honestly
 * flagged placeholder" discipline `AuthService.forgotPassword`'s dev-only reset-link logging
 * already established. `providerCustomerId`/`providerSubscriptionId` stay null — there is no
 * external id to hold.
 */
@Injectable()
export class LocalBillingProvider implements BillingProvider {
  readonly kind = 'local' as const;
  private readonly logger = new Logger(LocalBillingProvider.name);

  // No `await` in any of these three — genuinely synchronous (no network call to make), but the
  // interface returns `Promise<...>` since the real `StripeBillingProvider` counterpart does one.
  // `Promise.resolve(...)` rather than `async` keeps that honest instead of tripping
  // `@typescript-eslint/require-await`'s "this doesn't actually need to be async" check.
  provisionSubscription(input: {
    tenantName: string;
  }): Promise<ProvisionedSubscription> {
    const now = new Date();
    this.logger.warn(
      `[local-billing] Provisioning a ${TRIAL_DAYS}-day trial for "${input.tenantName}" — no ` +
        'STRIPE_SECRET_KEY configured, nothing was actually charged or synced to a real provider.',
    );
    return Promise.resolve({
      providerCustomerId: null,
      providerSubscriptionId: null,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * DAY_MS),
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
    });
  }

  changePlan(subscription: Subscription, plan: Plan): Promise<void> {
    this.logger.warn(
      `[local-billing] Subscription ${subscription.id} moved to plan ${plan.tier} — local mode, ` +
        'no provider call made.',
    );
    return Promise.resolve();
  }

  cancelSubscription(subscription: Subscription): Promise<void> {
    this.logger.warn(
      `[local-billing] Subscription ${subscription.id} marked to cancel at period end — local ` +
        'mode, no provider call made.',
    );
    return Promise.resolve();
  }
}
