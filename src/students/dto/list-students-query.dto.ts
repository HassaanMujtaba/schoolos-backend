import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { StudentStatus } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `GET /students?classId=&sectionId=&status=` — `students/api.ts`'s `StudentListParams`. */
export class ListStudentsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ enum: StudentStatus })
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;
}
