import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Subscription } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { lowerEnum, upperEnum } from './platform.mappers';
import { BILLING_PROVIDER, BillingProvider } from './billing-provider';
import { BillingService } from './billing.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import {
  CreateSubscriptionDto,
  SubscriptionResponseDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';

const SUBSCRIPTION_INCLUDE = {
  plan: true,
  tenant: { include: { school: true } },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;

/** `GET/POST/PATCH /platform/subscriptions` — see `dto/subscription.dto.ts`'s own comments on which of these three the current frontend actually calls. */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditLog: PlatformAuditLogService,
    private readonly billingRecords: BillingService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
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
    const [tenant, plan] = await Promise.all([
      this.platformPrisma.tenant.findUnique({
        where: { id: dto.tenantId },
        include: { school: true },
      }),
      this.platformPrisma.plan.findUnique({
        where: { tier: upperEnum(dto.plan) },
      }),
    ]);
    if (!tenant || !tenant.school) {
      throw new NotFoundException(`School ${dto.tenantId} not found`);
    }
    if (!plan) {
      throw new BadRequestException(`Plan tier "${dto.plan}" is not seeded`);
    }

    const provisioned = await this.billing.provisionSubscription({
      tenantName: tenant.school.name,
      contactEmail: tenant.school.email,
      plan,
    });

    try {
      const subscription = await this.platformPrisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: provisioned.trialEndsAt ? 'TRIALING' : 'ACTIVE',
          currentPeriodStart: provisioned.currentPeriodStart,
          currentPeriodEnd: provisioned.currentPeriodEnd,
          trialEndsAt: provisioned.trialEndsAt,
          stripeCustomerId: provisioned.providerCustomerId,
          stripeSubscriptionId: provisioned.providerSubscriptionId,
        },
        include: SUBSCRIPTION_INCLUDE,
      });
      await this.billingRecords.recordFirstPeriod({
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        amount: plan.priceMonthly,
        issuedAt: provisioned.currentPeriodStart,
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
    if (dto.plan && dto.cancelAtPeriodEnd) {
      throw new BadRequestException(
        'Change the plan or cancel the subscription — not both in the same request',
      );
    }
    const subscription = await this.findOrThrow(id);

    if (dto.plan) {
      const plan = await this.platformPrisma.plan.findUnique({
        where: { tier: upperEnum(dto.plan) },
      });
      if (!plan) {
        throw new BadRequestException(`Plan tier "${dto.plan}" is not seeded`);
      }
      await this.billing.changePlan(subscription, plan);
      const updated = await this.platformPrisma.subscription.update({
        where: { id },
        data: { planId: plan.id },
        include: SUBSCRIPTION_INCLUDE,
      });
      await this.auditLog.record({
        action: `subscription.plan_changed:${dto.plan}`,
        target: subscription.tenant.school?.name ?? subscription.tenant.name,
        tenantId: subscription.tenantId,
        tenantName:
          subscription.tenant.school?.name ?? subscription.tenant.name,
      });
      return toResponse(updated);
    }

    if (dto.cancelAtPeriodEnd) {
      await this.billing.cancelSubscription(subscription);
      const updated = await this.platformPrisma.subscription.update({
        where: { id },
        data: { cancelAtPeriodEnd: true, status: 'CANCELED' },
        include: SUBSCRIPTION_INCLUDE,
      });
      await this.auditLog.record({
        action: 'subscription.canceled',
        target: subscription.tenant.school?.name ?? subscription.tenant.name,
        tenantId: subscription.tenantId,
        tenantName:
          subscription.tenant.school?.name ?? subscription.tenant.name,
      });
      return toResponse(updated);
    }

    return toResponse(subscription);
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

/** MRR only counts a subscription that's actually collecting recurring revenue right now — a trialing or canceled one contributes $0, matching how `UsageStatTiles`' own "MRR" tile is meant to read (a real revenue figure, not "sum of every plan price regardless of status"). */
function toResponse(
  subscription: Subscription & {
    plan: { tier: string; priceMonthly: number };
    tenant: { id: string; name: string; school: { name: string } | null };
  },
): SubscriptionResponseDto {
  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    tenantName: subscription.tenant.school?.name ?? subscription.tenant.name,
    plan: lowerEnum(subscription.plan.tier),
    status: lowerEnum(subscription.status),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    mrr: subscription.status === 'ACTIVE' ? subscription.plan.priceMonthly : 0,
  };
}
