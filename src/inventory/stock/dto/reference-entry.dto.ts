import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `schemas.ts`'s `referenceEntrySchema` — stock categories, add/delete only, same shape as `library`'s own `ReferenceEntryDto`. */
export class ReferenceEntryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100)
  name!: string;
}
