import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

/** `frontend/src/features/attendance/schemas.ts`'s `attendanceRecordInputSchema`. */
export class AttendanceRecordInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  studentId!: string;

  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;
}

/**
 * `POST /attendance/bulk`'s body — `bulkAttendanceSchema`. One call submits a full class's marks,
 * per `attendance.md`'s "optimize for speed" requirement.
 */
export class BulkAttendanceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class is required' })
  classId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Section is required' })
  sectionId!: string;

  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Date is required' })
  date!: string;

  @ApiProperty({ type: [AttendanceRecordInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Mark at least one student' })
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordInputDto)
  records!: AttendanceRecordInputDto[];
}
