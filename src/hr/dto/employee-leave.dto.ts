import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { EmployeeLeaveType } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `POST /leave/employee`'s body — `frontend/src/features/hr/schemas.ts`'s `employeeLeaveRequestSchema`. */
export class SubmitEmployeeLeaveRequestDto {
  @ApiProperty({ enum: EmployeeLeaveType })
  @IsEnum(EmployeeLeaveType)
  leaveType!: EmployeeLeaveType;

  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Start date is required' })
  startDate!: string;

  @ApiProperty({ example: '2026-09-08' })
  @IsDateString({ strict: false }, { message: 'End date is required' })
  endDate!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Reason is required' })
  @MaxLength(500)
  reason!: string;
}

/** `PATCH /leave/employee/:id` — `employeeLeaveReviewSchema`. */
export class ReviewEmployeeLeaveRequestDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNotes?: string;
}

/**
 * `GET /leave/employee` — two documented shapes on one endpoint, same dual-shape split
 * `ListLeaveQueryDto` (student leave) already uses: `?employeeId=` (own history, plain array,
 * `'me'` accepted) or `?page=&pageSize=&status=` (the approval queue, paginated).
 */
export class ListEmployeeLeaveQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;
}

/** `GET /leave/employee/balances?employeeId=` — `employeeId` accepts `'me'`, same idiom as above. */
export class LeaveBalancesQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'employeeId is required' })
  employeeId!: string;
}
