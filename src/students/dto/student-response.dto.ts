import { ApiProperty } from '@nestjs/swagger';
import { StudentGender, StudentStatus } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

export class EmergencyContactDto {
  @ApiProperty() name!: string;
  @ApiProperty() relation!: string;
  @ApiProperty() phone!: string;
}

export class EnrollmentHistoryEntryDto {
  @ApiProperty() academicYearId!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
}

export class StudentSubjectDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class StudentDocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() url!: string;
  @ApiProperty() uploadedAt!: string;
}

/** `students/api.ts`'s `FamilyLink` — shared shape for `parents`/`guardians`/`siblings`. */
export class FamilyLinkDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() relation!: string;
}

/** `students/api.ts`'s `Student`. */
export class StudentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() admissionNumber!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) photoUrl!: string | null;
  @ApiProperty() dob!: string;
  @ApiProperty({ enum: StudentGender }) gender!: StudentGender;
  @ApiProperty() address!: string;
  @ApiProperty() nationality!: string;
  @ApiProperty() language!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
  @ApiProperty() academicYearId!: string;
  @ApiProperty({ enum: StudentStatus }) status!: StudentStatus;
  @ApiProperty() medicalInfo!: string;
  @ApiProperty({ type: [EmergencyContactDto] })
  emergencyContacts!: EmergencyContactDto[];
  @ApiProperty({ type: [EnrollmentHistoryEntryDto] })
  enrollmentHistory!: EnrollmentHistoryEntryDto[];
  @ApiProperty({ type: [StudentSubjectDto] }) subjects!: StudentSubjectDto[];
  /** Always `null` for now — see `students.service.ts`'s own doc comment. */
  @ApiProperty({ nullable: true, type: String }) classTeacherId!: string | null;
  @ApiProperty({ type: [StudentDocumentDto] }) documents!: StudentDocumentDto[];
  @ApiProperty({ type: [FamilyLinkDto] }) parents!: FamilyLinkDto[];
  @ApiProperty({ type: [FamilyLinkDto] }) guardians!: FamilyLinkDto[];
  @ApiProperty({ type: [FamilyLinkDto] }) siblings!: FamilyLinkDto[];
}

export class PagedStudentsDto implements PagedResult<StudentResponseDto> {
  @ApiProperty({ type: [StudentResponseDto] }) items!: StudentResponseDto[];
  @ApiProperty() total!: number;
}
