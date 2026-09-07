import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { AdmissionStage } from '@prisma/client';
import { CreateInquiryDto } from './create-inquiry.dto';
import { ApplicationDetailsDto } from './application-details.dto';

/**
 * `PATCH /admissions/:id` — `admissions/api.ts`'s `updateAdmission`. One endpoint for both stage
 * transitions and applicant/application-detail edits, per that file's own comment ("stage
 * transitions and applicant/application edits share one PATCH, per the assumed contract"). Stage
 * legality (which transitions are allowed, and which need more than the baseline
 * `admissions.update` permission) is enforced in `admissions.service.ts`, not by this DTO — see
 * `STAGE_TRANSITIONS` there.
 */
export class UpdateAdmissionDto {
  @ApiPropertyOptional({ enum: AdmissionStage })
  @IsOptional()
  @IsEnum(AdmissionStage)
  stage?: AdmissionStage;

  @ApiPropertyOptional({ type: CreateInquiryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateInquiryDto)
  applicant?: CreateInquiryDto;

  @ApiPropertyOptional({ type: ApplicationDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApplicationDetailsDto)
  applicationDetails?: ApplicationDetailsDto;
}
