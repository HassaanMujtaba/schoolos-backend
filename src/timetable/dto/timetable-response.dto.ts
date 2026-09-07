import { ApiProperty } from '@nestjs/swagger';

/** `frontend/src/features/timetable/api.ts`'s `TimetableEntry`. */
export class TimetableEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() teacherId!: string;
  @ApiProperty() roomId!: string;
  @ApiProperty() dayOfWeek!: number;
  @ApiProperty() periodIndex!: number;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
}

/** `frontend/src/features/timetable/api.ts`'s `Substitution`. */
export class SubstitutionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() date!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
  @ApiProperty() periodIndex!: number;
  @ApiProperty() subjectId!: string;
  @ApiProperty() originalTeacherId!: string;
  @ApiProperty() substituteTeacherId!: string;
  @ApiProperty() reason!: string;
}
