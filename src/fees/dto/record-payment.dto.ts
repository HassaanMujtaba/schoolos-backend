import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsPositive, IsString } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

/**
 * `POST /fees/invoices/:id/payments` — `frontend/src/features/fees/schemas.ts`'s `paymentSchema`.
 * That schema (and `RecordPaymentForm`'s submitted values) carries its own `invoiceId` field even
 * though the route already has one in the path — `InvoicesService.recordPayment` cross-checks the
 * two match (`dto.invoiceId !== invoiceId` → 400), same "route id wins, body id is checked not
 * trusted" convention `ExaminationsService.submitBulkMarks` already established for `examId`.
 */
export class RecordPaymentDto {
  @ApiProperty()
  @IsString()
  invoiceId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @IsPositive({ message: 'Amount must be greater than 0' })
  amount!: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  // Permitted-empty content, same `ExamDto.room` idiom — optional in practice (bank/gateway
  // reference), required as a field.
  @ApiProperty()
  @IsString()
  referenceId!: string;
}
