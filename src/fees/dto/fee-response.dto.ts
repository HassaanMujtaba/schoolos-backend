import { FeeType, InvoiceStatus, PaymentMethod } from '@prisma/client';
import { DiscountRuleInputDto } from './fee-structure.dto';

export class FeeStructureResponseDto {
  id!: string;
  name!: string;
  type!: FeeType;
  amount!: number;
  applicableClasses!: string[];
  discountRules!: DiscountRuleInputDto[];
}

export interface InvoiceLineItem {
  label: string;
  amount: number;
}

/**
 * `frontend/src/features/fees/api.ts`'s `Invoice` — `studentId` is typed `string` there, but a
 * pre-enrollment admission-fee invoice genuinely has none (see `Invoice`'s own schema.prisma doc
 * comment). This DTO returns the honest `string | null` and always resolves `studentName`/
 * `admissionNumber`/`className` from whichever side is actually set (the admission applicant's
 * name, with `admissionNumber`/`className` as `'—'`, when there's no student yet) — `fees.md`'s
 * own "Open questions" flags the frontend-side follow-up ("handle a studentId: null row... not a
 * blocking concern now") this resolves on the backend side without waiting on it.
 */
export class InvoiceResponseDto {
  id!: string;
  studentId!: string | null;
  admissionApplicationId!: string | null;
  studentName!: string;
  admissionNumber!: string;
  classId!: string;
  className!: string;
  feeStructureId!: string;
  lineItems!: InvoiceLineItem[];
  dueDate!: string;
  status!: InvoiceStatus;
  totalAmount!: number;
  paidAmount!: number;
  createdAt!: string;
}

export class PagedInvoiceDto {
  items!: InvoiceResponseDto[];
  total!: number;
}

export class PagedFeeStructureDto {
  items!: FeeStructureResponseDto[];
  total!: number;
}

export class PaymentResponseDto {
  id!: string;
  invoiceId!: string;
  studentName!: string;
  admissionNumber!: string;
  amount!: number;
  method!: PaymentMethod;
  referenceId!: string;
  receiptNumber!: string;
  paidAt!: string;
  refunded!: boolean;
}

export class PagedPaymentDto {
  items!: PaymentResponseDto[];
  total!: number;
}

export class ReceiptResponseDto {
  payment!: PaymentResponseDto;
  invoice!: Pick<
    InvoiceResponseDto,
    'id' | 'lineItems' | 'totalAmount' | 'dueDate'
  >;
  studentName!: string;
  admissionNumber!: string;
  className!: string;
}

export class OutstandingRowDto {
  id!: string;
  label!: string;
  totalInvoiced!: number;
  totalPaid!: number;
  totalOutstanding!: number;
}

export class OutstandingSummaryDto {
  totalCollected!: number;
  totalOutstanding!: number;
  rows!: OutstandingRowDto[];
}
