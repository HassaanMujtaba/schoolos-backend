import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** `frontend/src/features/school-setup/schemas.ts`'s `termSchema`. The `endDate >= startDate` refinement lives in `academic-years.service.ts` (server is the source of truth per the cross-cutting DoD, not just a mirrored zod `.refine()`). */
export class TermInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Term name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString({ strict: false }, { message: 'Start date is required' })
  startDate!: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString({ strict: false }, { message: 'End date is required' })
  endDate!: string;
}

/** `schemas.ts`'s `holidaySchema`. */
export class HolidayInputDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Holiday name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '2026-12-25' })
  @IsDateString({ strict: false }, { message: 'Date is required' })
  date!: string;
}

/**
 * `schemas.ts`'s `academicYearSchema` — one DTO for both create and edit, same reasoning as
 * `BranchDto`. `terms`/`holidays` are replaced wholesale on every write, same as branches'
 * buildings/departments.
 */
export class AcademicYearDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString({ strict: false }, { message: 'Start date is required' })
  startDate!: string;

  @ApiProperty({ example: '2027-03-31' })
  @IsDateString({ strict: false }, { message: 'End date is required' })
  endDate!: string;

  @ApiProperty({ type: [TermInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermInputDto)
  terms!: TermInputDto[];

  @ApiProperty({ type: [HolidayInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HolidayInputDto)
  holidays!: HolidayInputDto[];
}
