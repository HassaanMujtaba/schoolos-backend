import { ApiProperty } from '@nestjs/swagger';
import { SCHOOL_TYPES, SchoolTypeValue } from '../school-type';

/** `GET/PATCH /schools/current` response — `frontend/src/features/school-setup/api.ts`'s `School`. */
export class SchoolResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() website!: string;
  @ApiProperty() address!: string;
  @ApiProperty() registrationNumber!: string;
  @ApiProperty() taxInfo!: string;
  @ApiProperty({ enum: SCHOOL_TYPES }) schoolType!: SchoolTypeValue;
  @ApiProperty() timezone!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() language!: string;
  @ApiProperty() logoUrl!: string;
}
