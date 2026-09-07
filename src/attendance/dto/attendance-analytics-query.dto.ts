import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const ATTENDANCE_SCOPES = [
  'daily',
  'weekly',
  'monthly',
  'term',
] as const;
export type AttendanceScope = (typeof ATTENDANCE_SCOPES)[number];

export const ATTENDANCE_GROUP_BYS = [
  'student',
  'class',
  'teacher',
  'branch',
] as const;
export type AttendanceGroupBy = (typeof ATTENDANCE_GROUP_BYS)[number];

/** `GET /attendance/analytics?scope=&groupBy=` and `GET /attendance/export` (same params). */
export class AttendanceAnalyticsQueryDto {
  @ApiProperty({ enum: ATTENDANCE_SCOPES })
  @IsIn(ATTENDANCE_SCOPES)
  scope!: AttendanceScope;

  @ApiProperty({ enum: ATTENDANCE_GROUP_BYS })
  @IsIn(ATTENDANCE_GROUP_BYS)
  groupBy!: AttendanceGroupBy;
}
