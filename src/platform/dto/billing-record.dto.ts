import { ApiProperty } from '@nestjs/swagger';
import { PagedResult } from '../../common/pagination/list-query.dto';

export const BILLING_RECORD_STATUSES = ['paid', 'pending', 'failed'] as const;

/** `GET /platform/billing` — `frontend/src/features/platform/api.ts`'s `BillingRecord`. Read-only from this console (module doc lists only `GET`) — real records are written by `BillingWebhookController` as a provider's invoice events arrive, not by an admin action here. */
export class BillingRecordResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty() periodLabel!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ enum: BILLING_RECORD_STATUSES })
  status!: (typeof BILLING_RECORD_STATUSES)[number];
  @ApiProperty() issuedAt!: string;
}

export class PagedBillingRecordsDto implements PagedResult<BillingRecordResponseDto> {
  @ApiProperty({ type: [BillingRecordResponseDto] })
  items!: BillingRecordResponseDto[];
  @ApiProperty() total!: number;
}
