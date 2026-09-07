import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { StudentGender, StudentStatus } from '@prisma/client';

/** `frontend/src/features/students/schemas.ts`'s `emergencyContactSchema`. */
export class EmergencyContactInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Contact name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Relationship is required' })
  @MaxLength(100)
  relation!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @MaxLength(30)
  phone!: string;
}

/** `schemas.ts`'s `studentSchema` — one DTO for create and edit, same convention as `ClassDto`. */
export class StudentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Admission number is required' })
  @MaxLength(50)
  admissionNumber!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Student name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: '2015-06-01' })
  @IsDateString({ strict: false }, { message: 'Date of birth is required' })
  dob!: string;

  @ApiProperty({ enum: StudentGender })
  @IsEnum(StudentGender)
  gender!: StudentGender;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  address!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  nationality!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  language!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class is required' })
  classId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Section is required' })
  sectionId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Academic year is required' })
  academicYearId!: string;

  @ApiProperty({ enum: StudentStatus })
  @IsEnum(StudentStatus)
  status!: StudentStatus;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  medicalInfo!: string;

  @ApiProperty({ type: [EmergencyContactInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactInputDto)
  emergencyContacts!: EmergencyContactInputDto[];
}
