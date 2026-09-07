import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `GET /exams?classId=&sectionId=` plus the portal's `studentId` param
 * (`examinations.md`'s own "flagged open" assumption — `studentId` accepts `'me'`, the
 * `common/identity/resolve-me.ts` idiom, same as `homework`/`attendance`/`timetable`). `search`
 * is inherited from `ListQueryDto` but unused — `Exam` has no free-text name field to search on
 * (see `../../../implementation-plan.md`'s Phase 5 notes).
 */
export class ListExamsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}
