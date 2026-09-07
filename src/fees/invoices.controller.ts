import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { InvoicesService } from './invoices.service';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import {
  InvoiceResponseDto,
  PagedInvoiceDto,
  PaymentResponseDto,
} from './dto/fee-response.dto';

/** `frontend/src/features/fees/api.ts`'s invoice surface. */
@ApiTags('fees')
@Controller('fees/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('fees.read')
  list(@Query() query: ListInvoicesQueryDto): Promise<PagedInvoiceDto> {
    return this.invoices.list(query);
  }

  @Get(':id')
  @RequirePermission('fees.read')
  get(@Param('id') id: string): Promise<InvoiceResponseDto> {
    return this.invoices.get(id);
  }

  @Post()
  @RequirePermission('fees.create')
  generate(
    @Body() dto: GenerateInvoiceDto,
  ): Promise<InvoiceResponseDto | InvoiceResponseDto[]> {
    return this.invoices.generate(dto);
  }

  @Post(':id/payments')
  @RequirePermission('fees.collect')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.invoices.recordPayment(id, dto);
  }
}
