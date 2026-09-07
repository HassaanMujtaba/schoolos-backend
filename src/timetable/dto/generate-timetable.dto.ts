import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** `POST /timetable/generate`'s body — `frontend/src/features/timetable/api.ts`'s `generateTimetable`. */
export class GenerateTimetableDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  classId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sectionId!: string;
}
