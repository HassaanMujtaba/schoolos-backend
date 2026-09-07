import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** `frontend/src/features/admissions/schemas.ts`'s `scoringSchema` — `POST /admissions/:id/score`. */
export class ScoreApplicationDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  entranceTestScore?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  interviewNotes!: string;
}
