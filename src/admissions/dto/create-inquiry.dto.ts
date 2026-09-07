import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * `frontend/src/features/admissions/schemas.ts`'s `inquirySchema` — §7 "Admission inquiries", the
 * lightweight capture that starts the pipeline (`POST /admissions`). Field names are flattened
 * here (`name`, not `applicant.name`) to match the DB columns; `admissions.service.ts` nests them
 * back into `Admission.applicant` on the way out, matching `admissions/api.ts`'s response shape.
 */
export class CreateInquiryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: "Applicant's name is required" })
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: '2015-06-01' })
  @IsDateString({ strict: false }, { message: 'Date of birth is required' })
  dob!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class applied for is required' })
  classAppliedFor!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Contact phone is required' })
  @MaxLength(30)
  contactPhone!: string;

  // `.or(z.literal(''))` — same optional-content-not-optional-field shape as `ParentDto.email`.
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @ValidateIf((_, value: string) => value !== '')
  @IsEmail({}, { message: 'Enter a valid email address' })
  contactEmail!: string;
}
