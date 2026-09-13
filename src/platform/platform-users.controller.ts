import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { PlatformUsersService } from './platform-users.service';
import { PagedPlatformUsersDto } from './dto/platform-user.dto';

/** Read-only, so no `@SkipAudit()` needed (`AuditInterceptor` only fires on mutating methods). */
@ApiTags('platform')
@Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly platformUsers: PlatformUsersService) {}

  @Get()
  @RequirePermission('platform.support.read')
  search(@Query() query: ListQueryDto): Promise<PagedPlatformUsersDto> {
    return this.platformUsers.search(query);
  }
}
