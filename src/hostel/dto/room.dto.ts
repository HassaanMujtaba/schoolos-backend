import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RoomType } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** One shape for both create and edit, matching `schemas.ts`'s `roomSchema` field-for-field. */
export class RoomDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a hostel' })
  hostelId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  floorLabel!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Room number is required' })
  @MaxLength(20)
  roomNumber!: string;

  @ApiProperty({ minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Must be at least 1 bed' })
  @Max(50)
  capacity!: number;

  @ApiProperty({ enum: RoomType })
  @IsEnum(RoomType)
  roomType!: RoomType;
}

/** `api.ts`'s `RoomListParams` — the standard list query plus a `hostelId` filter. */
export class ListRoomsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hostelId?: string;
}

/** `GET /hostel/rooms/available?hostelId=` — `hostelId` is required here, unlike the list filter above. */
export class AvailableRoomsQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'hostelId is required' })
  hostelId!: string;
}
