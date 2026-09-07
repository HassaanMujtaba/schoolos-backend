import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** `frontend/src/features/admissions/schemas.ts`'s `applicationDetailsSchema`. */
export class ApplicationDetailsDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  address!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  previousSchool!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  notes!: string;
}
