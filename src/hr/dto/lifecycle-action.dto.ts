import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * `POST /hr/transfers`, `/hr/resignations`, `/hr/terminations` — one shared body shape per
 * `frontend/src/features/hr/api.ts`'s `recordLifecycleAction` (the `type` field itself is implied
 * by which endpoint was called, not part of the body — `api.ts` strips it before posting).
 * `newDepartment`/`newDesignation` are required only for the transfer endpoint, enforced by each
 * controller method passing its own `type` alongside this DTO to the service rather than a
 * per-endpoint DTO subclass, mirroring `lifecycleActionSchema`'s single-schema-plus-`.refine()`
 * shape client-side.
 */
export class LifecycleActionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Employee is required' })
  employeeId!: string;

  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Effective date is required' })
  effectiveDate!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Reason is required' })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  newDepartment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  newDesignation?: string;
}
