import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { BillingService } from './billing.service';
import { PagedBillingRecordsDto } from './dto/billing-record.dto';

/** `GET /platform/billing` — read-only from this console; a record moves `pending` → `paid` via `SubscriptionsService.confirmPayment` (`POST /platform/subscriptions/:id/confirm-payment`), not from a route here. */
@ApiTags('platform')
@Controller('platform/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('platform.billing.read')
  list(@Query() query: ListQueryDto): Promise<PagedBillingRecordsDto> {
    return this.billing.list(query);
  }
}
