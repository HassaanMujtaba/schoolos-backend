import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `GET /platform/audit-logs` — `frontend/src/features/platform/api.ts`'s `PlatformAuditLogEntry`. */
export class PlatformAuditLogEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() actor!: string;
  @ApiProperty() action!: string;
  @ApiProperty() target!: string;
  @ApiPropertyOptional() tenantName?: string;
  @ApiProperty() createdAt!: string;
}

export class PagedPlatformAuditLogDto implements PagedResult<PlatformAuditLogEntryDto> {
  @ApiProperty({ type: [PlatformAuditLogEntryDto] })
  items!: PlatformAuditLogEntryDto[];
  @ApiProperty() total!: number;
}
