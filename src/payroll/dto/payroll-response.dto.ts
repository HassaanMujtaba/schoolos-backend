import { ApiProperty } from '@nestjs/swagger';
import { PayrollPeriodStatus } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/payroll/schemas.ts`'s `SalaryStructureValues` — no `id`/`employeeId` in that type, so neither is returned here. */
export class SalaryStructureResponseDto {
  @ApiProperty() basicSalary!: number;
  @ApiProperty() housingAllowance!: number;
  @ApiProperty() transportAllowance!: number;
  @ApiProperty() otherAllowance!: number;
  @ApiProperty() taxDeduction!: number;
  @ApiProperty() loanDeduction!: number;
  @ApiProperty() otherDeduction!: number;
}

/** `frontend/src/features/payroll/api.ts`'s `PayrollPeriod`. */
export class PayrollPeriodResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty({ enum: PayrollPeriodStatus }) status!: PayrollPeriodStatus;
  /** Server-computed — the number of `Payslip` rows generated for this period (`0` while still `draft`). */
  @ApiProperty() employeeCount!: number;
}

export class PagedPayrollPeriodsDto implements PagedResult<PayrollPeriodResponseDto> {
  @ApiProperty({ type: [PayrollPeriodResponseDto] })
  items!: PayrollPeriodResponseDto[];
  @ApiProperty() total!: number;
}

/** `frontend/src/features/payroll/api.ts`'s `PayslipBreakdown`. */
export class PayslipBreakdownDto {
  @ApiProperty() basicSalary!: number;
  @ApiProperty() allowances!: number;
  @ApiProperty() overtime!: number;
  @ApiProperty() bonus!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() deductions!: number;
  @ApiProperty() absenceDeduction!: number;
  @ApiProperty() loanDeduction!: number;
  @ApiProperty() netPay!: number;
}

/** `frontend/src/features/payroll/api.ts`'s `Payslip`. */
export class PayslipResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() periodId!: string;
  @ApiProperty() periodLabel!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty() employeeDesignation!: string;
  @ApiProperty({ type: PayslipBreakdownDto }) breakdown!: PayslipBreakdownDto;
  @ApiProperty() generatedAt!: string;
}

export class PagedPayslipsDto implements PagedResult<PayslipResponseDto> {
  @ApiProperty({ type: [PayslipResponseDto] }) items!: PayslipResponseDto[];
  @ApiProperty() total!: number;
}
