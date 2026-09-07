import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** `POST /homework/:id/submissions`'s body — `submissionSchema`. No file field yet, see
 * `HomeworkSubmission.files`'s own schema doc comment. */
export class SubmissionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  textResponse!: string;
}
