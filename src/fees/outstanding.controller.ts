import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { InvoicesService } from './invoices.service';
import { OutstandingQueryDto } from './dto/outstanding-query.dto';
import { OutstandingSummaryDto } from './dto/fee-response.dto';

/**
 * `GET /fees/outstanding?groupBy=student|class` — its own controller since the route sits
 * directly under `/fees`, not `/fees/invoices` (`OutstandingBalancesPanel`'s own dashboard, not an
 * invoice-detail view).
 */
@ApiTags('fees')
@Controller('fees')
export class OutstandingController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('outstanding')
  @RequirePermission('fees.read')
  getOutstanding(
    @Query() query: OutstandingQueryDto,
  ): Promise<OutstandingSummaryDto> {
    return this.invoices.getOutstanding(query);
  }
}
