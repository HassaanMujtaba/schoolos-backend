import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
} from 'class-validator';
import { ExamType } from '@prisma/client';

/**
 * `frontend/src/features/examinations/schemas.ts`'s `examSchema` — one DTO for create and edit,
 * same convention as `HomeworkDto`/`TimetableEntryDto`. `room`/`startTime`/`endTime`/
 * `invigilatorId` are required *fields* but permitted-empty *content* (no `@IsNotEmpty`), matching
 * that schema's own `z.string().trim()`/`z.string()` (no `.min(1)`) choices.
 */
export class ExamDto {
  @ApiProperty({ enum: ExamType })
  @IsEnum(ExamType)
  type!: ExamType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  subjectId!: string;

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

  @ApiProperty()
  @IsString()
  startTime!: string;

  @ApiProperty()
  @IsString()
  endTime!: string;

  // Free text, not a select — no Room entity yet, same assumption `Section.roomLabel`/
  // `TimetableEntry.roomId` already document.
  @ApiProperty()
  @IsString()
  room!: string;

  // Optional content — not every exam type (e.g. a take-home Assignment) needs one.
  @ApiProperty()
  @IsString()
  invigilatorId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @IsPositive({ message: 'Max marks must be greater than 0' })
  maxMarks!: number;
}
