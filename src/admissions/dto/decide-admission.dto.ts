import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AdmissionDecision } from '@prisma/client';

/** `frontend/src/features/admissions/schemas.ts`'s `decisionSchema` — `PATCH /admissions/:id/decision`. */
export class DecideAdmissionDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  applicationScore?: number;

  @ApiProperty({ enum: AdmissionDecision })
  @IsEnum(AdmissionDecision)
  decision!: AdmissionDecision;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  decisionReason!: string;
}
