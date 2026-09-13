import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/**
 * `GET /reports/financial?from=&to=` — `reports-analytics.md`'s date-range filter bar, both ends
 * optional (`ReportsService.resolveFinancialRange`'s own doc comment covers the default window
 * applied when either is missing).
 */
export class FinancialReportQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString({ strict: false })
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString({ strict: false })
  to?: string;
}
