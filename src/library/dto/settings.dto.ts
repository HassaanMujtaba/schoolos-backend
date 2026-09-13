import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

/** `schemas.ts`'s `librarySettingsSchema` — `GET/PATCH /library/settings`. */
export class LibrarySettingsDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Must be 0 or more' })
  finePerDayRate!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Must be 0 or more' })
  maxFine?: number;
}
