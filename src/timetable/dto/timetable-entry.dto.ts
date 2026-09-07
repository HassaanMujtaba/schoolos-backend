import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * `frontend/src/features/timetable/schemas.ts`'s `timetableEntrySchema` plus the
 * class/section/day/period fields `SlotEditorDialog` resolves from the grid cell it was opened
 * from before flattening into `TimetableEntryPayload` — one DTO for create and edit, same
 * convention as `StudentDto`.
 */
export class TimetableEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class is required' })
  classId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Section is required' })
  sectionId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  subjectId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Teacher is required' })
  teacherId!: string;

  // Free text, not a select — no Room entity yet, same as `schemas.ts`'s own note.
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  roomId!: string;

  // 0 = Monday, per `constants.ts` WEEKDAYS — a Monday–Saturday six-day week (unconfirmed with
  // product, see `timetable.md`'s "Open questions").
  @ApiProperty({ minimum: 0, maximum: 5 })
  @IsInt()
  @Min(0)
  @Max(5)
  dayOfWeek!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  periodIndex!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Start time is required' })
  startTime!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'End time is required' })
  endTime!: string;
}
