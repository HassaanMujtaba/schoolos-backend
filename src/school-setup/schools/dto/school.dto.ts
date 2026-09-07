import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SCHOOL_TYPES, SchoolTypeValue } from '../school-type';

/**
 * `frontend/src/features/school-setup/schemas.ts`'s `schoolProfileSchema` (one schema, used by
 * `SchoolProfileForm` for both view-populate and edit — there's no separate create flow, a school
 * row always exists by the time this is called, see `schools.service.ts`'s lazy-create note).
 * `email`/`website`/`logoUrl` are required *fields* that may hold `''` (the frontend's own
 * `.email().or(z.literal(''))` pattern) rather than optional fields — `@ValidateIf` mirrors that:
 * validate the format only when non-empty, but the key must still be present as a string.
 */
export class SchoolProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'School name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @ValidateIf((o: SchoolProfileDto) => o.email !== '')
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @ValidateIf((o: SchoolProfileDto) => o.website !== '')
  @IsUrl({}, { message: 'Enter a valid URL' })
  website!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  address!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  registrationNumber!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  taxInfo!: string;

  @ApiProperty({ enum: SCHOOL_TYPES })
  @IsIn(SCHOOL_TYPES)
  schoolType!: SchoolTypeValue;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Time zone is required' })
  @MaxLength(100)
  timezone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Currency is required' })
  @MaxLength(10)
  currency!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'Language is required' })
  @MaxLength(50)
  language!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  @ValidateIf((o: SchoolProfileDto) => o.logoUrl !== '')
  @IsUrl({}, { message: 'Enter a valid URL' })
  logoUrl!: string;
}
