import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** `frontend/src/features/transport/schemas.ts`'s `routeStopSchema` — a flat repeatable name/time list, not its own nested CRUD resource, same `BuildingInputDto` convention. */
export class RouteStopInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Stop name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(10)
  time!: string;
}

/**
 * One schema for both create and edit, matching `schemas.ts`'s `routeSchema` field-for-field.
 * `stops` is replaced wholesale on every write, same convention as `VehicleDto.maintenanceRecords`.
 * `studentIds` is a plain string array — referential integrity against real `Student` rows is
 * enforced in `routes.service.ts`, not a DB foreign key, same trade-off as `Subject.classIds`/
 * `Teacher.subjectIds`. `feeStructureId` is `''` for "no linkage" (`RouteForm.tsx`'s own
 * `NO_FEE_STRUCTURE` sentinel maps back to `''`), normalized to `null` in `routes.service.ts`.
 */
export class RouteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Route name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Vehicle is required' })
  vehicleId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  driverName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  attendantName!: string;

  @ApiProperty()
  @IsString()
  feeStructureId!: string;

  @ApiProperty({ type: [RouteStopInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteStopInputDto)
  stops!: RouteStopInputDto[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  studentIds!: string[];
}
