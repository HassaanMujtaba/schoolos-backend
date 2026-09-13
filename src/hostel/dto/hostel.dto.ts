import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { HostelType } from '@prisma/client';

/** One shape for both create and edit, matching `frontend/src/features/hostel/schemas.ts`'s `hostelSchema` field-for-field. */
export class HostelDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Hostel name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: HostelType })
  @IsEnum(HostelType)
  type!: HostelType;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  address!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  wardenName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  notes!: string;
}
