import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

/**
 * `frontend/src/features/hr/schemas.ts`'s `employeeSchema` — one shape for both create and edit.
 * `teacherId` isn't part of that assumed contract (the frontend doesn't send it yet — see
 * `Employee.teacherId`'s own schema doc comment on the teacher↔employee linkage), but is accepted
 * here as optional so the real link can be set once a caller threads it through.
 */
export class EmployeeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(200)
  name!: string;

  // `.or(z.literal(''))` on the frontend — same optional-content-not-optional-field shape as
  // `TeacherDto.email`.
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

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Department is required' })
  @MaxLength(100)
  department!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Designation is required' })
  @MaxLength(100)
  designation!: string;

  @ApiProperty({ enum: EmploymentType })
  @IsEnum(EmploymentType)
  employmentType!: EmploymentType;

  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Date of joining is required' })
  dateOfJoining!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;
}
