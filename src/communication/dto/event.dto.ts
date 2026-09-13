import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EventAudience } from '@prisma/client';

/**
 * `EVENT_TYPES` — the frontend's own hyphenated wire values. `EventsService` translates to/from
 * the Prisma `EventType` enum's underscore members (see that enum's own schema doc comment); kept
 * here as a plain `@IsIn` string check, not `@IsEnum(EventType)`, precisely because the wire shape
 * and the storage shape differ.
 */
export const EVENT_TYPES_WIRE = [
  'holiday',
  'exam',
  'ptm',
  'sports-day',
  'annual-function',
  'field-trip',
  'meeting',
  'other',
] as const;
export type EventTypeWire = (typeof EVENT_TYPES_WIRE)[number];

/** `eventSchema` — one shape for create and edit. `startTime`/`endTime`/`location`/`description` are required-but-possibly-empty strings, same "optional content, not an optional field" idiom `EmployeeDto.email`/`.phone` already use. */
export class EventDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: EVENT_TYPES_WIRE })
  @IsIn(EVENT_TYPES_WIRE)
  type!: EventTypeWire;

  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Date is required' })
  date!: string;

  @ApiProperty()
  @IsString()
  startTime!: string;

  @ApiProperty()
  @IsString()
  endTime!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  location!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  description!: string;

  @ApiProperty({ enum: EventAudience })
  @IsEnum(EventAudience)
  audience!: EventAudience;

  @ApiProperty({ type: [String] })
  @ValidateIf((dto: EventDto) => dto.audience === 'class')
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one class' })
  @IsString({ each: true })
  classIds!: string[];
}
