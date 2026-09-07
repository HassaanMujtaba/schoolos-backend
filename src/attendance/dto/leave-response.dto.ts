import { ApiProperty } from '@nestjs/swagger';
import { LeaveStatus } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

export class LeaveDateRangeDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
}

/** `frontend/src/features/attendance/api.ts`'s `LeaveRequest`. */
export class LeaveRequestResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() studentId!: string;
  @ApiProperty() studentName!: string;
  @ApiProperty({ type: LeaveDateRangeDto }) dateRange!: LeaveDateRangeDto;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: LeaveStatus }) status!: LeaveStatus;
  @ApiProperty() submittedBy!: string;
  @ApiProperty({ nullable: true, type: String }) reviewedBy!: string | null;
  @ApiProperty({ nullable: true, type: String }) reviewNotes!: string | null;
}

/** `GET /leave/student` without `studentId` — the teacher/admin review queue's paged shape. */
export class PagedLeaveRequestsDto implements PagedResult<LeaveRequestResponseDto> {
  @ApiProperty({ type: [LeaveRequestResponseDto] })
  items!: LeaveRequestResponseDto[];
  @ApiProperty() total!: number;
}
