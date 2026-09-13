import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { PagedResult } from '../../common/pagination/list-query.dto';
import { SCHOOL_PLAN_TIERS } from './school.dto';

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
] as const;

/**
 * `POST /platform/subscriptions` — provisions a subscription for a tenant that doesn't have one
 * yet. Not called by the current frontend (`SubscriptionsPage`/`SubscriptionTable` are read-only —
 * every tenant already gets one automatically from `POST /platform/schools`'s own onboarding
 * flow); kept for the documented contract's own completeness and for backfilling a tenant that
 * somehow doesn't have one (`SchoolsService.create`'s transaction is the only normal path, so this
 * should stay rare).
 */
export class CreateSubscriptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @ApiProperty({ enum: SCHOOL_PLAN_TIERS })
  @IsIn(SCHOOL_PLAN_TIERS)
  plan!: (typeof SCHOOL_PLAN_TIERS)[number];
}

/** `PATCH /platform/subscriptions/:id` — same "not called by the current frontend, kept for contract completeness" caveat as `CreateSubscriptionDto`. Exactly one of `plan`/`cancelAtPeriodEnd` per call — changing plan and canceling in the same request is ambiguous about ordering, so this DTO doesn't allow it rather than guessing which happens first. */
export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ enum: SCHOOL_PLAN_TIERS })
  @IsOptional()
  @IsIn(SCHOOL_PLAN_TIERS)
  plan?: (typeof SCHOOL_PLAN_TIERS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cancelAtPeriodEnd?: boolean;
}

/** `frontend/src/features/platform/api.ts`'s `Subscription`. */
export class SubscriptionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ enum: SCHOOL_PLAN_TIERS })
  plan!: (typeof SCHOOL_PLAN_TIERS)[number];
  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  status!: (typeof SUBSCRIPTION_STATUSES)[number];
  @ApiProperty() currentPeriodEnd!: string;
  @ApiProperty() mrr!: number;
}

export class PagedSubscriptionsDto implements PagedResult<SubscriptionResponseDto> {
  @ApiProperty({ type: [SubscriptionResponseDto] })
  items!: SubscriptionResponseDto[];
  @ApiProperty() total!: number;
}
