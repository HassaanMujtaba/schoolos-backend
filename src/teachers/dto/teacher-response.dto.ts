import { ApiProperty } from '@nestjs/swagger';
import { PagedResult } from '../../common/pagination/list-query.dto';

export class QualificationDto {
  @ApiProperty() degree!: string;
  @ApiProperty() institution!: string;
  @ApiProperty() year!: string;
}

/** `teachers/api.ts`'s `Teacher`. */
export class TeacherResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty({ required: false }) experienceYears?: number;
  @ApiProperty({ type: [QualificationDto] })
  qualifications!: QualificationDto[];
  @ApiProperty({ type: [String] }) subjectIds!: string[];
  /** Distinct `classId`s across this teacher's `TeacherAssignment` rows. */
  @ApiProperty({ type: [String] }) classIds!: string[];
}

export class PagedTeachersDto implements PagedResult<TeacherResponseDto> {
  @ApiProperty({ type: [TeacherResponseDto] }) items!: TeacherResponseDto[];
  @ApiProperty() total!: number;
}

/** `teachers/api.ts`'s `Assignment`. */
export class AssignmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() teacherId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
}
