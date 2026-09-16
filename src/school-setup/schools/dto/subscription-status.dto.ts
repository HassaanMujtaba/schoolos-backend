import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SUBSCRIPTION_STATUSES = [
  'active',
  'grace',
  'suspended',
  'canceled',
] as const;

/** `GET /schools/current/subscription-status` — the banner/reminder data a School Owner/Admin sees for their own tenant. Gated on `school.billing.read`, seeded only for those two roles (`prisma/seed.ts`) — a teacher/student/parent calling this gets a 403, which is what tells the frontend banner not to render at all rather than a separate role check. */
export class SubscriptionStatusResponseDto {
  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  status!: (typeof SUBSCRIPTION_STATUSES)[number];
  @ApiProperty() currentPeriodEnd!: string;
  @ApiPropertyOptional() graceEndsAt?: string | null;
  @ApiProperty() monthlyAmount!: number;
}
