import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

/** `PATCH /attendance/:id` — `attendance.modify`'s single-record correction. */
export class UpdateAttendanceDto {
  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;
}
