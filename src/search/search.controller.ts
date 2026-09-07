import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { SearchService } from './search.service';
import { SearchResultDto } from './dto/search-response.dto';

/**
 * `GET /search?q=&type=` — `CommandPalette`'s only consumer. No `@RequirePermission`: any
 * authenticated user may search, but `SearchService` gates each result category on that
 * category's own read permission (a Teacher's search never surfaces an invoice, for instance) —
 * same "no route-level gate, ownership/permission enforced in the service instead" pattern
 * `LeaveController`/`ReportCardsController` already use for a shared, cross-role route.
 */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @Query('q') q: string,
    @Query('type') type: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SearchResultDto[]> {
    return this.searchService.search(q, type, user);
  }
}
