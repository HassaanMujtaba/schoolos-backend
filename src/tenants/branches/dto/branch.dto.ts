import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** `frontend/src/features/school-setup/schemas.ts`'s `buildingSchema` — a flat repeatable name list, not its own nested CRUD resource (see `Branch`'s own doc comment in schema.prisma). */
export class BuildingInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Building name is required' })
  @MaxLength(200)
  name!: string;
}

/** `schemas.ts`'s `departmentSchema` — same shape as `BuildingInputDto`. */
export class DepartmentInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Department name is required' })
  @MaxLength(200)
  name!: string;
}

/**
 * One schema for both create and edit, matching `frontend/src/features/school-setup/schemas.ts`'s
 * own `branchSchema` (used by both `BranchFormPage`'s new and edit modes) field-for-field.
 * `buildings`/`departments` are replaced wholesale on every write — `branches.service.ts` deletes
 * and re-creates the child rows rather than diffing, matching the semantics of a
 * `useFieldArray`-submitted full list.
 */
export class BranchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Branch name is required' })
  @MaxLength(200)
  name!: string;

  // Required (present, can be ''), not optional — mirrors schemas.ts's deliberate choice not to
  // use zod .default()/.optional() (see that file's own top comment on zodResolver typing).
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  campus!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  address!: string;

  @ApiProperty({ type: [BuildingInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuildingInputDto)
  buildings!: BuildingInputDto[];

  @ApiProperty({ type: [DepartmentInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DepartmentInputDto)
  departments!: DepartmentInputDto[];
}
