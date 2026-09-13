import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AnnouncementAudience } from '@prisma/client';

/**
 * `announcementSchema` — one shape for create and edit. `classIds` is only required non-empty
 * when `audience === 'class'` (the frontend's own `.refine()`), re-enforced server-side via
 * `@ValidateIf`; `AnnouncementsService` also normalizes it to `[]` for a "school" audience
 * regardless of what's sent, so a stale value never lingers on an audience switch.
 */
export class AnnouncementDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Body is required' })
  @MaxLength(4000)
  body!: string;

  @ApiProperty({ enum: AnnouncementAudience })
  @IsEnum(AnnouncementAudience)
  audience!: AnnouncementAudience;

  @ApiProperty({ type: [String] })
  @ValidateIf((dto: AnnouncementDto) => dto.audience === 'class')
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one class' })
  @IsString({ each: true })
  classIds!: string[];

  @ApiProperty()
  @IsBoolean()
  pinned!: boolean;
}
