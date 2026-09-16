import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingRecord, Prisma } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { lowerEnum } from './platform.mappers';
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
    timeZone: 'Asia/Karachi',
  }).format(date);
}

/**
 * `GET /platform/billing` plus the two mutations that keep it current:
 * `createPendingRecord` (a new period's charge, called by `SchoolsService.create` and
 * `SubscriptionsService.confirmPayment` on renewal) and `confirmPendingRecord` (a Platform Admin
 * manually marking the current period's charge as paid — `SubscriptionsService.confirmPayment`'s
 * own doc comment covers the renewal-date math around this).
 */
@Injectable()
export class BillingService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

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

  /** Creates the `PENDING` charge for a subscription period — once at onboarding, then once per renewal (`SubscriptionsService.confirmPayment`). */
  async createPendingRecord(input: {
    tenantId: string;
    subscriptionId: string;
    amount: number;
    issuedAt: Date;
  }): Promise<BillingRecord> {
    return this.platformPrisma.billingRecord.create({
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

  /** Marks a subscription's one outstanding `PENDING` record `PAID`. Throws if there isn't exactly one — every subscription always has one once `createPendingRecord` has run, so a missing one means the subscription itself is missing/misconfigured, not a legitimate "nothing to confirm" state. */
  async confirmPendingRecord(
    subscriptionId: string,
    input: {
      confirmedByUserId: string;
      confirmedByName: string;
      paidAt: Date;
      note?: string;
    },
  ): Promise<BillingRecord> {
    const pending = await this.platformPrisma.billingRecord.findFirst({
      where: { subscriptionId, status: 'PENDING' },
      orderBy: { issuedAt: 'desc' },
    });
    if (!pending) {
      throw new BadRequestException(
        `Subscription ${subscriptionId} has no pending charge to confirm`,
      );
    }
    return this.platformPrisma.billingRecord.update({
      where: { id: pending.id },
      data: {
        status: 'PAID',
        paidAt: input.paidAt,
        confirmedByUserId: input.confirmedByUserId,
        confirmedByName: input.confirmedByName,
        note: input.note,
      },
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
    confirmedBy: record.confirmedByName,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    note: record.note,
  };
}
