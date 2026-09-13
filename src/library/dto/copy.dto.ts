import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `schemas.ts`'s `copySchema`. */
export class CopyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Barcode is required' })
  @MaxLength(60)
  barcode!: string;
}
