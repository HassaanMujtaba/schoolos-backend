import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Subscription } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { lowerEnum } from './platform.mappers';
import { BillingService } from './billing.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { addOneMonthPkt, startOfTodayPkt } from '../common/dates/pkt-time';
import {
  ConfirmPaymentDto,
  CreateSubscriptionDto,
  SubscriptionResponseDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';

const SUBSCRIPTION_INCLUDE = {
  tenant: { include: { school: true } },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;

/** `GET/POST/PATCH /platform/subscriptions` plus `confirmPayment` — see `dto/subscription.dto.ts`'s own comments on which of these the current frontend actually calls. */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly auditLog: PlatformAuditLogService,
    private readonly billingRecords: BillingService,
  ) {}

  async list(
    query: ListQueryDto,
  ): Promise<PagedResult<SubscriptionResponseDto>> {
    const where: Prisma.SubscriptionWhereInput = query.search
      ? {
          tenant: {
            school: { name: { contains: query.search, mode: 'insensitive' } },
          },
        }
      : {};
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.platformPrisma.subscription.findMany({
          where,
          include: SUBSCRIPTION_INCLUDE,
          orderBy: { currentPeriodEnd: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.platformPrisma.subscription.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async create(dto: CreateSubscriptionDto): Promise<SubscriptionResponseDto> {
    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { id: dto.tenantId },
      include: { school: true },
    });
    if (!tenant || !tenant.school) {
      throw new NotFoundException(`School ${dto.tenantId} not found`);
    }

    const start = startOfTodayPkt();
    try {
      const subscription = await this.platformPrisma.subscription.create({
        data: {
          tenantId: tenant.id,
          monthlyAmount: dto.monthlyAmount,
          status: 'ACTIVE',
          currentPeriodStart: start,
          currentPeriodEnd: addOneMonthPkt(start),
        },
        include: SUBSCRIPTION_INCLUDE,
      });
      await this.billingRecords.createPendingRecord({
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        amount: dto.monthlyAmount,
        issuedAt: start,
      });
      await this.auditLog.record({
        action: 'subscription.created',
        target: tenant.school.name,
        tenantId: tenant.id,
        tenantName: tenant.school.name,
      });
      return toResponse(subscription);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `${tenant.school.name} already has a subscription`,
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    if (dto.monthlyAmount && dto.cancel) {
      throw new BadRequestException(
        'Change the price or cancel the subscription — not both in the same request',
      );
    }
    const subscription = await this.findOrThrow(id);
    const tenantName =
      subscription.tenant.school?.name ?? subscription.tenant.name;

    if (dto.monthlyAmount) {
      // Takes effect on the *next* renewal, not retroactively on the period already in progress —
      // `confirmPayment` always charges whatever `monthlyAmount` reads at that time.
      const updated = await this.platformPrisma.subscription.update({
        where: { id },
        data: { monthlyAmount: dto.monthlyAmount },
        include: SUBSCRIPTION_INCLUDE,
      });
      await this.auditLog.record({
        action: `subscription.price_changed:${dto.monthlyAmount}`,
        target: tenantName,
        tenantId: subscription.tenantId,
        tenantName,
      });
      return toResponse(updated);
    }

    if (dto.cancel) {
      const updated = await this.platformPrisma.subscription.update({
        where: { id },
        data: { status: 'CANCELED', graceEndsAt: null },
        include: SUBSCRIPTION_INCLUDE,
      });
      await this.auditLog.record({
        action: 'subscription.canceled',
        target: tenantName,
        tenantId: subscription.tenantId,
        tenantName,
      });
      return toResponse(updated);
    }

    return toResponse(subscription);
  }

  /**
   * A Platform Admin manually confirming a payment received outside the platform for the current
   * period's `PENDING` `BillingRecord`. Renews from `subscription.currentPeriodEnd` as it stood
   * *before* this call — the original expiry, never `paidAt`/`now` — so a payment confirmed
   * partway through (or even after) the grace window doesn't shift the next period: expiry 1 Oct +
   * 5-day grace, payment confirmed 4 Oct → new period is 1 Oct → 1 Nov, not 4 Oct → 4 Nov.
   */
  async confirmPayment(
    id: string,
    dto: ConfirmPaymentDto,
  ): Promise<SubscriptionResponseDto> {
    const subscription = await this.findOrThrow(id);
    const tenantName =
      subscription.tenant.school?.name ?? subscription.tenant.name;
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const actorUserId = this.requestContext.userId;
    const actor = actorUserId
      ? await this.platformPrisma.user.findUnique({
          where: { id: actorUserId },
          select: { name: true, email: true },
        })
      : null;

    await this.billingRecords.confirmPendingRecord(subscription.id, {
      confirmedByUserId: actorUserId ?? 'system',
      confirmedByName: actor?.name ?? actor?.email ?? 'system',
      paidAt,
      note: dto.note,
    });

    const newStart = subscription.currentPeriodEnd;
    const newEnd = addOneMonthPkt(newStart);
    const updated = await this.platformPrisma.subscription.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: newStart,
        currentPeriodEnd: newEnd,
        graceEndsAt: null,
        lastReminderEmailAt: null,
      },
      include: SUBSCRIPTION_INCLUDE,
    });
    await this.billingRecords.createPendingRecord({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      amount: updated.monthlyAmount,
      issuedAt: newStart,
    });
    // Reinstate a school the sweep had auto-suspended for this same non-payment — a confirmed
    // payment should restore access immediately, not wait for a separate manual reinstate.
    if (subscription.tenant.status === 'SUSPENDED') {
      await this.platformPrisma.tenant.update({
        where: { id: subscription.tenantId },
        data: { status: 'ACTIVE' },
      });
    }
    await this.auditLog.record({
      action: 'subscription.payment_confirmed',
      target: tenantName,
      tenantId: subscription.tenantId,
      tenantName,
    });

    return toResponse(updated);
  }

  private async findOrThrow(id: string): Promise<SubscriptionWithRelations> {
    const subscription = await this.platformPrisma.subscription.findUnique({
      where: { id },
      include: SUBSCRIPTION_INCLUDE,
    });
    if (!subscription) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }
    return subscription;
  }
}

/** MRR only counts a subscription that's actually collecting recurring revenue right now — a suspended or canceled one contributes 0, matching how `UsageStatTiles`' own "MRR" tile is meant to read (a real revenue figure, not "sum of every subscription's price regardless of status"). A subscription in its grace window still counts — it's still owed, just not yet confirmed. */
function toResponse(
  subscription: Subscription & {
    tenant: { id: string; name: string; school: { name: string } | null };
  },
): SubscriptionResponseDto {
  const collecting =
    subscription.status === 'ACTIVE' || subscription.status === 'GRACE';
  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    tenantName: subscription.tenant.school?.name ?? subscription.tenant.name,
    monthlyAmount: subscription.monthlyAmount,
    status: lowerEnum(subscription.status),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
    mrr: collecting ? subscription.monthlyAmount : 0,
  };
}
