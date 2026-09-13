import { ApiProperty } from '@nestjs/swagger';

/** `GET /platform/usage` — `frontend/src/features/platform/api.ts`'s `PlatformUsage`. See `usage.service.ts`'s own doc comment for which of these fields are real aggregates vs. honestly-flagged placeholders (no instrumentation exists yet for the ones that are). */
export class PlatformUsageResponseDto {
  @ApiProperty() activeSchools!: number;
  @ApiProperty() activeUsers!: number;
  @ApiProperty() activeStudents!: number;
  @ApiProperty() mrr!: number;
  @ApiProperty() churnRatePct!: number;
  @ApiProperty() storageUsedGb!: number;
  @ApiProperty() apiCallsToday!: number;
  @ApiProperty() aiTokensToday!: number;
  @ApiProperty() errorRate24hPct!: number;
  @ApiProperty() backgroundJobsPending!: number;
}
