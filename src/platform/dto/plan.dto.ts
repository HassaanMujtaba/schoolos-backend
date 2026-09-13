import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { SCHOOL_PLAN_TIERS } from './school.dto';

/**
 * `frontend/src/features/platform/schemas.ts`'s `planFormSchema` — one shape for both
 * `POST`/`PATCH /platform/plans`, matching every other module's single-DTO-for-create-and-edit
 * convention. `PlanForm`'s own comment: this console edits an existing tier's price/limits/
 * features, it doesn't build an arbitrary tier catalog — `POST` (only reachable server-side, the
 * frontend never calls it — `PlanCard`/`PlansConfigPage` only ever `PATCH`) still requires `tier`
 * to be one of the fixed three, same as everywhere else this enum is validated.
 */
export class PlanDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0, { message: 'Price must be 0 or more' })
  priceMonthly!: number;

  @ApiProperty()
  @IsInt()
  @Min(1, { message: 'Must allow at least 1 branch' })
  maxBranches!: number;

  @ApiProperty()
  @IsInt()
  @Min(1, { message: 'Must allow at least 1 student' })
  maxStudents!: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  features!: string[];
}

export class CreatePlanDto extends PlanDto {
  @ApiProperty({ enum: SCHOOL_PLAN_TIERS })
  @IsIn(SCHOOL_PLAN_TIERS)
  tier!: (typeof SCHOOL_PLAN_TIERS)[number];
}

/** `frontend/src/features/platform/api.ts`'s `Plan`. */
export class PlanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SCHOOL_PLAN_TIERS })
  tier!: (typeof SCHOOL_PLAN_TIERS)[number];
  @ApiProperty() name!: string;
  @ApiProperty() priceMonthly!: number;
  @ApiProperty() maxBranches!: number;
  @ApiProperty() maxStudents!: number;
  @ApiProperty({ type: [String] }) features!: string[];
}
