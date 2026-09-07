import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { InvoicesService } from './invoices.service';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import {
  PagedPaymentDto,
  PaymentResponseDto,
  ReceiptResponseDto,
} from './dto/fee-response.dto';

/** `frontend/src/features/fees/api.ts`'s payment/receipt surface. */
@ApiTags('fees')
@Controller('fees/payments')
export class PaymentsController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('fees.read')
  list(@Query() query: ListPaymentsQueryDto): Promise<PagedPaymentDto> {
    return this.invoices.listPayments(query);
  }

  @Post(':id/refund')
  @RequirePermission('fees.refund')
  @HttpCode(HttpStatus.OK)
  refund(@Param('id') id: string): Promise<PaymentResponseDto> {
    return this.invoices.refundPayment(id);
  }

  @Get(':id/receipt')
  @RequirePermission('fees.read')
  getReceipt(@Param('id') id: string): Promise<ReceiptResponseDto> {
    return this.invoices.getReceipt(id);
  }
}
