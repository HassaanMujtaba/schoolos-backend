import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** `frontend/src/features/teachers/schemas.ts`'s `assignmentSchema`. */
export class AssignmentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  subjectId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class is required' })
  classId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Section is required' })
  sectionId!: string;
}
