import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `POST /payroll/periods`'s body — `frontend/src/features/payroll/schemas.ts`'s `payrollPeriodSchema`. */
export class PayrollPeriodDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'A label is required (e.g. "March 2026")' })
  @MaxLength(100)
  label!: string;

  @ApiProperty({ example: '2026-03-01' })
  @IsDateString({ strict: false }, { message: 'Start date is required' })
  startDate!: string;

  @ApiProperty({ example: '2026-03-31' })
  @IsDateString({ strict: false }, { message: 'End date is required' })
  endDate!: string;
}

/** `GET /payroll/payslips` — `api.ts`'s `PayslipListParams`. */
export class ListPayslipsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodId?: string;

  /** Accepts the `'me'` idiom, same convention as `features/hr`'s leave endpoints. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;
}
