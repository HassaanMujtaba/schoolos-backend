import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * `frontend/src/features/examinations/schemas.ts`'s `marksEntryRecordSchema`. `marksObtained` is
 * a required *field* that's nullable *content* — `null` means "not entered yet"/absent, mutually
 * exclusive with `isAbsent` at the record level (that cross-field rule is re-enforced in
 * `examinations.service.ts`, not by a decorator here — class-validator has no direct `.refine()`
 * equivalent, and "reject, don't sanitize-and-continue" per `security-standards` means this needs
 * a real check, not a silently-accepted inconsistent record).
 */
export class MarksEntryRecordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Student is required' })
  studentId!: string;

  @ApiProperty({ nullable: true, type: Number })
  @ValidateIf((record: MarksEntryRecordDto) => record.marksObtained !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  marksObtained!: number | null;

  @ApiProperty()
  @IsBoolean()
  isAbsent!: boolean;
}

/**
 * `POST /exams/:id/marks`'s body — `bulkMarksSchema`. One call submits a full class's marks for
 * one subject, same "bulk grid, not N requests" requirement `BulkAttendanceDto` already
 * documents. `examId` here is validated against the route's own `:id` param in the service
 * (mismatch → 400), not trusted as the source of truth on its own.
 */
export class BulkMarksDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  examId!: string;

  @ApiProperty({ type: [MarksEntryRecordDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'No students to submit' })
  @ValidateNested({ each: true })
  @Type(() => MarksEntryRecordDto)
  records!: MarksEntryRecordDto[];
}
