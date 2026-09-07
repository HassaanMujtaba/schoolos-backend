import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `GET /fees/payments?invoiceId=` — `frontend/src/features/fees/api.ts`'s `PaymentListParams`. */
export class ListPaymentsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceId?: string;
}
