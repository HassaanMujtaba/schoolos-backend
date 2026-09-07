import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { FamilyRelation } from '@prisma/client';

/** `POST /parents/:id/children` — `parents/api.ts`'s `linkChild` payload. */
export class LinkChildDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'A student is required' })
  studentId!: string;

  @ApiProperty({ enum: FamilyRelation })
  @IsEnum(FamilyRelation)
  relation!: FamilyRelation;
}
