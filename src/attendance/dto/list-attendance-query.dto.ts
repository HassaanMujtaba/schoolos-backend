import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * `GET /attendance` — two documented shapes on one query DTO, per `attendance/api.ts`'s own
 * comment: `?classId=&sectionId=&date=` (the class-marking view) or `?studentId=&from=&to=` (the
 * portal history view, an assumed REST extension per `attendance.md`'s "Open questions";
 * `studentId` accepts `'me'`, the `common/identity/resolve-me.ts` idiom).
 */
export class ListAttendanceQueryDto {
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
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  to?: string;
}
