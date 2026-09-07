import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubmissionStatus } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/homework/api.ts`'s `HomeworkAttachment` — always `[]` for now, see
 * `Homework.attachments`'s own schema doc comment. */
export class HomeworkAttachmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() url!: string;
}

/** `frontend/src/features/homework/api.ts`'s `Homework`. */
export class HomeworkResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [HomeworkAttachmentDto] })
  attachments!: HomeworkAttachmentDto[];
  @ApiProperty({ type: [String] }) links!: string[];
  @ApiProperty() deadline!: string;
  @ApiProperty({ type: [String] }) classIds!: string[];
  @ApiProperty({ type: [String] }) sectionIds!: string[];
  @ApiProperty() teacherId!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional() submissionCount?: number;
  @ApiPropertyOptional() studentCount?: number;
  // Not the Prisma `SubmissionStatus` enum — `'not_submitted'` has no row to attach to (a
  // `HomeworkSubmission` only ever exists once actually submitted, see that model's own schema
  // doc comment), so this three-value display status is computed here, not stored anywhere.
  @ApiPropertyOptional({ enum: ['not_submitted', 'submitted', 'graded'] })
  mySubmissionStatus?: 'not_submitted' | 'submitted' | 'graded';
}

export class PagedHomeworkDto implements PagedResult<HomeworkResponseDto> {
  @ApiProperty({ type: [HomeworkResponseDto] }) items!: HomeworkResponseDto[];
  @ApiProperty() total!: number;
}

/** `frontend/src/features/homework/api.ts`'s `Submission`, plus its `SubmissionStatus`. */
export class SubmissionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() homeworkId!: string;
  @ApiProperty() studentId!: string;
  @ApiProperty() studentName!: string;
  @ApiProperty({ type: [HomeworkAttachmentDto] })
  files!: HomeworkAttachmentDto[];
  @ApiProperty() textResponse!: string;
  @ApiProperty({ nullable: true, type: String }) submittedAt!: string | null;
  @ApiProperty({ enum: SubmissionStatus }) status!: SubmissionStatus;
  @ApiProperty({ nullable: true, type: String }) grade!: string | null;
  @ApiProperty({ nullable: true, type: String }) feedback!: string | null;
  @ApiProperty({ nullable: true, type: String }) gradedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) gradedBy!: string | null;
}
