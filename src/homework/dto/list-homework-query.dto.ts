import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `GET /homework?classId=&teacherId=` plus the portal's `studentId` param (an assumed REST
 * extension per `homework.md`'s own "Open questions" — `studentId` accepts `'me'`, the
 * `common/identity/resolve-me.ts` idiom).
 */
export class ListHomeworkQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}
