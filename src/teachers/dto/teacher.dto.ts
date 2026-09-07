import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  IsEmail,
} from 'class-validator';

/** `frontend/src/features/teachers/schemas.ts`'s `qualificationSchema`. */
export class QualificationInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Degree/qualification is required' })
  degree!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  institution!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(9)
  year!: string;
}

/** `schemas.ts`'s `teacherSchema` — one DTO for create and edit. */
export class TeacherDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Teacher name is required' })
  @MaxLength(200)
  name!: string;

  // `.or(z.literal(''))` — same optional-content-not-optional-field shape as `ParentDto.email`.
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @ValidateIf((_, value: string) => value !== '')
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  phone!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Employee ID is required' })
  @MaxLength(50)
  employeeId!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  experienceYears?: number;

  @ApiProperty({ type: [QualificationInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QualificationInputDto)
  qualifications!: QualificationInputDto[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  subjectIds!: string[];
}
