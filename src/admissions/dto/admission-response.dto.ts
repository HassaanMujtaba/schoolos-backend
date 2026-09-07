import { ApiProperty } from '@nestjs/swagger';
import { AdmissionDecision, AdmissionStage } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

export class ApplicantDto {
  @ApiProperty() name!: string;
  @ApiProperty() dob!: string;
  @ApiProperty() classAppliedFor!: string;
  @ApiProperty() contactPhone!: string;
  @ApiProperty() contactEmail!: string;
}

export class ApplicationDetailsResponseDto {
  @ApiProperty() address!: string;
  @ApiProperty() previousSchool!: string;
  @ApiProperty() notes!: string;
}

/** `admissions/api.ts`'s `AdmissionDocument` — placeholder shape, see `SubmitDocumentsDto`'s comment. */
export class AdmissionDocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() url!: string;
}

/** `admissions/api.ts`'s `Admission`. */
export class AdmissionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AdmissionStage }) stage!: AdmissionStage;
  @ApiProperty({ type: ApplicantDto }) applicant!: ApplicantDto;
  @ApiProperty({ type: ApplicationDetailsResponseDto })
  applicationDetails!: ApplicationDetailsResponseDto;
  @ApiProperty({ type: [AdmissionDocumentDto] })
  documents!: AdmissionDocumentDto[];
  @ApiProperty({ nullable: true, type: Number }) entranceTestScore!:
    number | null;
  @ApiProperty() interviewNotes!: string;
  @ApiProperty({ nullable: true, type: Number }) applicationScore!:
    number | null;
  @ApiProperty({ enum: AdmissionDecision }) decision!: AdmissionDecision;
  @ApiProperty() decisionReason!: string;
  @ApiProperty({ nullable: true, type: String }) admissionFeeInvoiceId!:
    string | null;
  @ApiProperty({ nullable: true, type: String }) enrolledStudentId!:
    string | null;
  @ApiProperty() createdAt!: string;
}

export class PagedAdmissionsDto implements PagedResult<AdmissionResponseDto> {
  @ApiProperty({ type: [AdmissionResponseDto] }) items!: AdmissionResponseDto[];
  @ApiProperty() total!: number;
}
