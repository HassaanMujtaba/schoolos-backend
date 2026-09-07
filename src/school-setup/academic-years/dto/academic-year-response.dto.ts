import { ApiProperty } from '@nestjs/swagger';

export class TermResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
}

export class HolidayResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() date!: string;
}

/** `GET/POST/PATCH /academic-years` response — `frontend/src/features/school-setup/api.ts`'s `AcademicYear`. */
export class AcademicYearResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty({ type: [TermResponseDto] }) terms!: TermResponseDto[];
  @ApiProperty({ type: [HolidayResponseDto] }) holidays!: HolidayResponseDto[];
}

export class PagedAcademicYearsDto {
  @ApiProperty({ type: [AcademicYearResponseDto] })
  items!: AcademicYearResponseDto[];
  @ApiProperty() total!: number;
}
