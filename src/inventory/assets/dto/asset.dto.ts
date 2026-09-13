import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AssetCategory } from '@prisma/client';

/**
 * `schemas.ts`'s `ASSET_STATUSES` — a plain string, not a Prisma enum, see `schema.prisma`'s
 * `Asset.status` doc comment for why (hyphenated literals a Prisma enum member name can't hold).
 */
export const ASSET_STATUSES = [
  'in-use',
  'in-storage',
  'under-maintenance',
  'disposed',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * `frontend/src/features/inventory/schemas.ts`'s `assetMaintenanceRecordSchema` — a flat
 * repeatable date/description/cost list, replaced wholesale on every asset write, same
 * `MaintenanceRecordInputDto` convention `VehicleDto` already set. `cost` arrives already a number
 * (`AssetForm`'s own `register`'s `setValueAs`, no `.transform()` at the field level).
 */
export class AssetMaintenanceRecordInputDto {
  @ApiProperty()
  @IsDateString({ strict: false }, { message: 'Date is required' })
  date!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  @MaxLength(300)
  description!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number;
}

/**
 * One schema for both create and edit, matching `schemas.ts`'s `assetSchema` field-for-field.
 * `warrantyExpiryDate`/`disposalDate` are required fields that may hold `''` — same
 * `ValidateIf`-guarded-format pattern `VehicleDto.insuranceExpiryDate` already uses: validate the
 * date format only when non-empty, key stays required. The cross-field "disposal date required
 * once status is disposed" rule (`assetSchema`'s own `.refine`) is enforced in
 * `AssetsService.assertDisposalDateIfDisposed` instead of here, matching this codebase's own
 * "business rule, not a decorator" convention for cross-field checks.
 */
export class AssetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Asset ID is required' })
  @MaxLength(50)
  assetCode!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: AssetCategory })
  @IsEnum(AssetCategory)
  category!: AssetCategory;

  @ApiProperty({ enum: ASSET_STATUSES })
  @IsIn(ASSET_STATUSES)
  status!: AssetStatus;

  @ApiProperty()
  @IsDateString({ strict: false }, { message: 'Purchase date is required' })
  purchaseDate!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0, { message: 'Cost cannot be negative' })
  purchaseCost!: number;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Must be at least 1 year' })
  usefulLifeYears!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  location!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  assignedTo!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(10)
  @ValidateIf((o: AssetDto) => o.warrantyExpiryDate !== '')
  @IsDateString({ strict: false }, { message: 'Enter a valid date' })
  warrantyExpiryDate!: string;

  @ApiProperty({ type: [AssetMaintenanceRecordInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssetMaintenanceRecordInputDto)
  maintenanceRecords!: AssetMaintenanceRecordInputDto[];

  @ApiProperty()
  @IsString()
  @MaxLength(10)
  @ValidateIf((o: AssetDto) => o.disposalDate !== '')
  @IsDateString({ strict: false }, { message: 'Enter a valid date' })
  disposalDate!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  disposalReason!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  disposalValue?: number;
}
