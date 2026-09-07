import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { AdmissionStage } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `GET /admissions?stage=` — `admissions/api.ts`'s `AdmissionListParams`. */
export class ListAdmissionsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: AdmissionStage })
  @IsOptional()
  @IsEnum(AdmissionStage)
  stage?: AdmissionStage;
}
