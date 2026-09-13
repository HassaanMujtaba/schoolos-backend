import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export const REPORT_EXPORT_FORMATS = ['pdf', 'excel', 'csv'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export const REPORT_KINDS = [
  'principal-dashboard',
  'academic',
  'financial',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * `GET /reports/:id/export?format=` — `frontend/src/features/reports/api.ts`'s `exportReport`.
 * Carries every filter field any of the three report kinds accepts (`classId`/`subjectId` for
 * `academic`, `from`/`to` for `financial`) in one DTO rather than three — `ReportsController`
 * picks which ones it actually reads based on the validated `:id`, same "one query DTO, kind
 * decides which fields matter" trade-off `attendance/dto/attendance-analytics-query.dto.ts`'s
 * `scope`/`groupBy` pair already makes.
 */
export class ExportReportQueryDto {
  @ApiProperty({ enum: REPORT_EXPORT_FORMATS })
  @IsIn(REPORT_EXPORT_FORMATS)
  format!: ReportExportFormat;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString({ strict: false })
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString({ strict: false })
  to?: string;
}
