import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateIf,
} from 'class-validator';

export const INVOICE_GENERATE_MODES = ['student', 'class'] as const;
export type InvoiceGenerateMode = (typeof INVOICE_GENERATE_MODES)[number];

/**
 * `frontend/src/features/fees/schemas.ts`'s `invoiceGenerateSchema` discriminated union, flattened
 * into one DTO with `@ValidateIf(mode)` conditional requirements — `class-validator` has no
 * built-in discriminated-union validator, so the per-mode requiredness that zod's union expresses
 * declaratively is expressed here as explicit per-field conditions instead. `POST /fees/invoices`
 * branches on `mode` in the service (`InvoicesService.generate`), returning one `Invoice` for
 * `'student'` or an array for `'class'` — matching `api.ts generateInvoice`'s own
 * `Promise<Invoice | Invoice[]>` return type exactly.
 */
export class GenerateInvoiceDto {
  @ApiProperty({ enum: INVOICE_GENERATE_MODES })
  @IsIn(INVOICE_GENERATE_MODES)
  mode!: InvoiceGenerateMode;

  @ApiProperty({ required: false })
  @ValidateIf((o: GenerateInvoiceDto) => o.mode === 'student')
  @IsString()
  @IsNotEmpty({ message: 'Select a student' })
  studentId?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o: GenerateInvoiceDto) => o.mode === 'class')
  @IsString()
  @IsNotEmpty({ message: 'Select a class' })
  classId?: string;

  // Empty string means "every section" — present (required field, permitted-empty content) for
  // `mode: 'class'`, same idiom `ExamDto`'s `room`/`invigilatorId` document.
  @ApiProperty({ required: false })
  @ValidateIf((o: GenerateInvoiceDto) => o.mode === 'class')
  @IsString()
  sectionId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a fee structure' })
  feeStructureId!: string;

  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Due date is required' })
  dueDate!: string;
}
