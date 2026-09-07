import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `frontend/src/features/school-setup/schemas.ts`'s `sectionSchema` — one DTO for create and edit. */
export class SectionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Section name is required' })
  @MaxLength(50)
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class is required' })
  classId!: string;

  // Required-but-can-be-empty, same as Branch's campus/address — no Teachers/Rooms entity yet
  // (schema.prisma's own note on this model).
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  classTeacherName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  roomLabel!: string;
}
