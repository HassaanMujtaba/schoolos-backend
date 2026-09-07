import { ApiProperty } from '@nestjs/swagger';
import { SubjectType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

/** `frontend/src/features/school-setup/schemas.ts`'s `subjectSchema` — one DTO for create and edit. */
export class SubjectDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subject code is required' })
  @MaxLength(20)
  code!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subject name is required' })
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: SubjectType })
  @IsEnum(SubjectType)
  type!: SubjectType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  classIds!: string[];
}
