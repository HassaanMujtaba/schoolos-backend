import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `schemas.ts`'s `referenceEntrySchema` — shared shape for categories and shelves alike. */
export class ReferenceEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100)
  name!: string;
}
