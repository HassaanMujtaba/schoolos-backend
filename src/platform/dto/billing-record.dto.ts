import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PagedResult } from '../../common/pagination/list-query.dto';

export const BILLING_RECORD_STATUSES = ['paid', 'pending', 'failed'] as const;

/** `GET /platform/billing` — `frontend/src/features/platform/api.ts`'s `BillingRecord`. Read-only from this list (module doc lists only `GET`) — a record moves `pending` → `paid` via `SubscriptionsService.confirmPayment` (`POST /platform/subscriptions/:id/confirm-payment`), not from here directly. */
export class BillingRecordResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty() periodLabel!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ enum: BILLING_RECORD_STATUSES })
  status!: (typeof BILLING_RECORD_STATUSES)[number];
  @ApiProperty() issuedAt!: string;
  @ApiPropertyOptional() confirmedBy?: string | null;
  @ApiPropertyOptional() confirmedAt?: string | null;
  @ApiPropertyOptional() note?: string | null;
}

export class PagedBillingRecordsDto implements PagedResult<BillingRecordResponseDto> {
  @ApiProperty({ type: [BillingRecordResponseDto] })
  items!: BillingRecordResponseDto[];
  @ApiProperty() total!: number;
}
