import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * `GET /timetable` — the three view modes `frontend/src/features/timetable/api.ts` calls this
 * with: `?classId=&sectionId=` (class view), `?teacherId=` (teacher view — accepts `'me'`, the
 * `common/identity/resolve-me.ts` idiom), `?roomId=` (room view). All optional on one DTO rather
 * than three separate query shapes since the frontend always supplies exactly one mode's params
 * per call.
 */
export class ListTimetableQueryDto {
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
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roomId?: string;
}
