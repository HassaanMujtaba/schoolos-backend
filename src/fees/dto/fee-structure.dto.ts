import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { FeeType } from '@prisma/client';

export const DISCOUNT_KINDS = ['flat', 'percentage'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/**
 * `frontend/src/features/fees/schemas.ts`'s `discountRuleSchema` — a flat repeatable
 * label/kind/value list, not its own nested CRUD resource, same `BuildingInputDto`/
 * `DepartmentInputDto` "replaced wholesale on every write" convention.
 */
export class DiscountRuleInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Label is required' })
  label!: string;

  @ApiProperty({ enum: DISCOUNT_KINDS })
  @IsIn(DISCOUNT_KINDS)
  kind!: DiscountKind;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Must be 0 or greater' })
  value!: number;
}

/**
 * `schemas.ts`'s `feeStructureSchema` — one DTO for create and edit, same convention as
 * `BranchDto`/`ExamDto`.
 */
export class FeeStructureDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: FeeType })
  @IsEnum(FeeType)
  type!: FeeType;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @IsPositive({ message: 'Amount must be greater than 0' })
  amount!: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one class' })
  @IsString({ each: true })
  applicableClasses!: string[];

  @ApiProperty({ type: [DiscountRuleInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscountRuleInputDto)
  discountRules!: DiscountRuleInputDto[];
}
