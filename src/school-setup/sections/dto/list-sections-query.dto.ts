import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../common/pagination/list-query.dto';

/** `GET /sections?classId=` — `frontend/src/features/school-setup/api.ts`'s `listSections` accepts an optional `classId` filter alongside the standard list params. */
export class ListSectionsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;
}
