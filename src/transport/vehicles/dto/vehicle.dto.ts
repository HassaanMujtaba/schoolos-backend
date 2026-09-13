import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { VehicleStatus, VehicleType } from '@prisma/client';

/**
 * `frontend/src/features/transport/schemas.ts`'s `maintenanceRecordSchema` — a flat repeatable
 * date/description/cost list, replaced wholesale on every vehicle write, same
 * `BuildingInputDto`/`DepartmentInputDto` "still a real child table underneath" convention. `cost`
 * arrives already a number (`VehicleForm`'s own `register`'s `setValueAs`, per that schema's own
 * comment: no `.transform()` at the field level).
 */
export class MaintenanceRecordInputDto {
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
 * One schema for both create and edit, matching `schemas.ts`'s `vehicleSchema` field-for-field.
 * `maintenanceRecords` is replaced wholesale on every write (delete-then-recreate), same as
 * `BranchDto`'s buildings/departments. `driverName`/`driverPhone`/`insuranceProvider` are required
 * fields that may hold `''` — no Staff/HR module yet, same free-text placeholder `Section.
 * classTeacherName` already set.
 */
export class VehicleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Registration number is required' })
  @MaxLength(50)
  registrationNumber!: string;

  @ApiProperty({ enum: VehicleType })
  @IsEnum(VehicleType)
  type!: VehicleType;

  @ApiProperty({ minimum: 1, maximum: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Capacity must be at least 1' })
  @Max(200)
  capacity!: number;

  @ApiProperty({ enum: VehicleStatus })
  @IsEnum(VehicleStatus)
  status!: VehicleStatus;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  driverName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  driverPhone!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  insuranceProvider!: string;

  // Required field that may hold '' (schemas.ts's `insuranceExpiryDate: z.string().max(10)`, no
  // `.min(1)`) — same `ValidateIf`-guarded-format pattern `SchoolProfileDto`'s email/website/
  // logoUrl already use: validate the date format only when non-empty, key stays required.
  @ApiProperty()
  @IsString()
  @MaxLength(10)
  @ValidateIf((o: VehicleDto) => o.insuranceExpiryDate !== '')
  @IsDateString({ strict: false }, { message: 'Enter a valid date' })
  insuranceExpiryDate!: string;

  @ApiProperty({ type: [MaintenanceRecordInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaintenanceRecordInputDto)
  maintenanceRecords!: MaintenanceRecordInputDto[];
}
