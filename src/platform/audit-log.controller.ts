import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PagedPlatformAuditLogDto } from './dto/platform-audit-log.dto';

/** `GET /platform/audit-logs` — read-only; every write comes from `PlatformAuditLogService.record` called by every other controller in this module. */
@ApiTags('platform')
@Controller('platform/audit-logs')
export class AuditLogController {
  constructor(private readonly auditLog: PlatformAuditLogService) {}

  @Get()
  @RequirePermission('platform.audit.read')
  list(@Query() query: ListQueryDto): Promise<PagedPlatformAuditLogDto> {
    return this.auditLog.list(query);
  }
}
