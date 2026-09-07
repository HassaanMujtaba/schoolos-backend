import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** `frontend/src/features/school-setup/schemas.ts`'s `classSchema` — one DTO for create and edit. */
export class ClassDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Class name is required' })
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  gradeLevel?: number;
}
