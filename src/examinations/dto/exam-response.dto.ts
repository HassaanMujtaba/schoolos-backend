import { ApiProperty } from '@nestjs/swagger';
import { ExamType } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/**
 * `frontend/src/features/examinations/api.ts`'s `Exam` — `extends ExamFormValues { id }`. No
 * `isPublished` here on purpose — that field doesn't exist on the frontend's own `Exam` type, only
 * on `ExamResultsResponseDto` below (see `Exam.isPublished`'s own schema doc comment).
 */
export class ExamResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ExamType }) type!: ExamType;
  @ApiProperty() subjectId!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
  @ApiProperty() date!: string;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
  @ApiProperty() room!: string;
  @ApiProperty() invigilatorId!: string;
  @ApiProperty() maxMarks!: number;
}

export class PagedExamDto implements PagedResult<ExamResponseDto> {
  @ApiProperty({ type: [ExamResponseDto] }) items!: ExamResponseDto[];
  @ApiProperty() total!: number;
}

/** `frontend/src/features/examinations/api.ts`'s `MarksEntryRow`. */
export class MarksEntryRowDto {
  @ApiProperty() studentId!: string;
  @ApiProperty() studentName!: string;
  @ApiProperty() admissionNumber!: string;
  @ApiProperty({ nullable: true, type: Number }) marksObtained!: number | null;
  @ApiProperty() isAbsent!: boolean;
}

/** `frontend/src/features/examinations/api.ts`'s `MarksEntrySheet`. */
export class MarksEntrySheetResponseDto {
  @ApiProperty() examId!: string;
  @ApiProperty() maxMarks!: number;
  @ApiProperty() isLocked!: boolean;
  @ApiProperty({ type: [MarksEntryRowDto] }) rows!: MarksEntryRowDto[];
}

/** `frontend/src/features/examinations/api.ts`'s `ExamResultRow`. */
export class ExamResultRowDto {
  @ApiProperty() studentId!: string;
  @ApiProperty() studentName!: string;
  @ApiProperty() admissionNumber!: string;
  @ApiProperty({ nullable: true, type: Number }) marksObtained!: number | null;
  @ApiProperty() isAbsent!: boolean;
  @ApiProperty({ nullable: true, type: Number }) percentage!: number | null;
  @ApiProperty({ nullable: true, type: String }) grade!: string | null;
  @ApiProperty({ nullable: true, type: Number }) gpa!: number | null;
  @ApiProperty({ nullable: true, type: Number }) rank!: number | null;
}

/** `frontend/src/features/examinations/api.ts`'s `ExamResults`. */
export class ExamResultsResponseDto {
  @ApiProperty() examId!: string;
  @ApiProperty() isPublished!: boolean;
  @ApiProperty({ type: [ExamResultRowDto] }) rows!: ExamResultRowDto[];
}

/** `frontend/src/features/examinations/api.ts`'s `ReportCardSubjectRow`. */
export class ReportCardSubjectRowDto {
  @ApiProperty() subjectId!: string;
  @ApiProperty() subjectName!: string;
  @ApiProperty() maxMarks!: number;
  @ApiProperty({ nullable: true, type: Number }) marksObtained!: number | null;
  @ApiProperty() isAbsent!: boolean;
  @ApiProperty({ nullable: true, type: String }) grade!: string | null;
}

/** `frontend/src/features/examinations/api.ts`'s `ReportCard`. */
export class ReportCardResponseDto {
  @ApiProperty() studentId!: string;
  @ApiProperty() studentName!: string;
  @ApiProperty() admissionNumber!: string;
  @ApiProperty() className!: string;
  @ApiProperty() sectionName!: string;
  @ApiProperty() examId!: string;
  @ApiProperty() examName!: string;
  @ApiProperty({ type: [ReportCardSubjectRowDto] })
  subjects!: ReportCardSubjectRowDto[];
  @ApiProperty() totalMarksObtained!: number;
  @ApiProperty() totalMaxMarks!: number;
  @ApiProperty() percentage!: number;
  @ApiProperty({ nullable: true, type: String }) grade!: string | null;
  @ApiProperty({ nullable: true, type: Number }) gpa!: number | null;
  @ApiProperty({ nullable: true, type: Number }) rank!: number | null;
}
