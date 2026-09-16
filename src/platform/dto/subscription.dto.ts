import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PagedResult } from '../../common/pagination/list-query.dto';

export const SUBSCRIPTION_STATUSES = [
  'active',
  'grace',
  'suspended',
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

  @ApiProperty({ description: 'Negotiated monthly subscription price, in PKR' })
  @IsNumber()
  @IsPositive()
  monthlyAmount!: number;
}

/** `PATCH /platform/subscriptions/:id` — exactly one of `monthlyAmount`/`cancel` per call, same "ambiguous ordering" reasoning the previous plan/cancel version of this DTO gave. A price change here takes effect on the *next* renewal (`SubscriptionsService.update`), not retroactively on the period already in progress. */
export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ description: 'Renegotiated monthly price, in PKR' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  monthlyAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cancel?: boolean;
}

/** `POST /platform/subscriptions/:id/confirm-payment` — a Platform Admin manually confirming a payment received outside the platform (bank transfer, cash, etc.) for the current period's `PENDING` `BillingRecord`. Renews from the subscription's *original* `currentPeriodEnd`, never from `paidAt`. */
export class ConfirmPaymentDto {
  @ApiPropertyOptional({
    description: 'Date payment was actually received; defaults to now',
  })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional({ description: 'e.g. "Received via bank transfer"' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** `frontend/src/features/platform/api.ts`'s `Subscription`. */
export class SubscriptionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty() monthlyAmount!: number;
  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  status!: (typeof SUBSCRIPTION_STATUSES)[number];
  @ApiProperty() currentPeriodEnd!: string;
  @ApiPropertyOptional() graceEndsAt?: string | null;
  @ApiProperty() mrr!: number;
}

export class PagedSubscriptionsDto implements PagedResult<SubscriptionResponseDto> {
  @ApiProperty({ type: [SubscriptionResponseDto] })
  items!: SubscriptionResponseDto[];
  @ApiProperty() total!: number;
}
