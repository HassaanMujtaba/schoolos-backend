import { ApiProperty } from '@nestjs/swagger';
import { EmployeeLeaveStatus, EmployeeLeaveType } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

export class EmployeeLeaveDateRangeDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
}

/** `frontend/src/features/hr/api.ts`'s `EmployeeLeaveRequest`. */
export class EmployeeLeaveResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty() employeeName!: string;
  @ApiProperty({ enum: EmployeeLeaveType }) leaveType!: EmployeeLeaveType;
  @ApiProperty({ type: EmployeeLeaveDateRangeDto })
  dateRange!: EmployeeLeaveDateRangeDto;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: EmployeeLeaveStatus }) status!: EmployeeLeaveStatus;
  @ApiProperty({ nullable: true, type: String }) reviewedBy!: string | null;
  @ApiProperty({ nullable: true, type: String }) reviewNotes!: string | null;
}

/** `GET /leave/employee` without `employeeId` — the approval queue's paged shape. */
export class PagedEmployeeLeaveDto implements PagedResult<EmployeeLeaveResponseDto> {
  @ApiProperty({ type: [EmployeeLeaveResponseDto] })
  items!: EmployeeLeaveResponseDto[];
  @ApiProperty() total!: number;
}

/** `frontend/src/features/hr/api.ts`'s `EmployeeLeaveBalance`. */
export class LeaveBalanceResponseDto {
  @ApiProperty({ enum: EmployeeLeaveType }) leaveType!: EmployeeLeaveType;
  @ApiProperty() allotted!: number;
  @ApiProperty() used!: number;
}
