import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
} from 'class-validator';

/**
 * `frontend/src/features/timetable/api.ts`'s `SubstitutionPayload` — already flattened from
 * `SubstitutionForm`'s `originalEntryId` lookup (`schemas.ts`'s own comment) by the time it
 * reaches this API, so this DTO takes the flat shape directly, not `originalEntryId`.
 */
export class SubstitutionDto {
  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Date is required' })
  date!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class is required' })
  classId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Section is required' })
  sectionId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  periodIndex!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  subjectId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Original teacher is required' })
  originalTeacherId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Substitute teacher is required' })
  substituteTeacherId!: string;

  @ApiProperty()
  @IsString()
  reason!: string;
}
