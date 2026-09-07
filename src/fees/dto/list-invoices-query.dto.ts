import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `GET /fees/invoices?studentId=&classId=&status=` — `frontend/src/features/fees/api.ts`'s
 * `InvoiceListParams`. `search` (inherited) is unused today — no free-text field on `Invoice`
 * itself worth matching on, same "inherited but unused" note `ListExamsQueryDto` documents for its
 * own `search`.
 */
export class ListInvoicesQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}
