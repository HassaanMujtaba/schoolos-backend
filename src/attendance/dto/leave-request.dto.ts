import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /leave/student`'s body — `frontend/src/features/attendance/schemas.ts`'s
 * `leaveRequestSchema`. Parent-side submission, own child only — enforced server-side
 * (`leave.service.ts`'s own doc comment), per `SECURITY.md` A01.
 */
export class SubmitLeaveRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Student is required' })
  studentId!: string;

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
