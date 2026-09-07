import { ApiProperty } from '@nestjs/swagger';
import { AttendanceStatus } from '@prisma/client';

/** `frontend/src/features/attendance/api.ts`'s `AttendanceRecord`. */
export class AttendanceRecordResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() studentId!: string;
  @ApiProperty() studentName!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
  @ApiProperty() date!: string;
  @ApiProperty({ enum: AttendanceStatus }) status!: AttendanceStatus;
  @ApiProperty() markedBy!: string;
  @ApiProperty() markedAt!: string;
}

export class AttendanceAnalyticsRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() presentCount!: number;
  @ApiProperty() absentCount!: number;
  @ApiProperty() totalCount!: number;
  /** 0–1. */
  @ApiProperty() attendanceRate!: number;
}

/** `frontend/src/features/attendance/api.ts`'s `AttendanceAnalytics`. */
export class AttendanceAnalyticsResponseDto {
  /** 0–1, today's overall present rate — the dashboard's headline `StatTile`, always "today"
   * regardless of the requested `scope`, per `api.ts`'s own comment. */
  @ApiProperty() todayPresentRate!: number;
  @ApiProperty({ type: [AttendanceAnalyticsRowDto] })
  rows!: AttendanceAnalyticsRowDto[];
}
