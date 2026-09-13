import { ApiProperty } from '@nestjs/swagger';
import { EventAudience } from '@prisma/client';
import { EVENT_TYPES_WIRE, EventTypeWire } from './event.dto';

/** `frontend/src/features/communication/api.ts`'s `SchoolEvent`. */
export class EventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: EVENT_TYPES_WIRE }) type!: EventTypeWire;
  @ApiProperty() date!: string;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
  @ApiProperty() location!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: EventAudience }) audience!: EventAudience;
  @ApiProperty({ type: [String] }) classIds!: string[];
  @ApiProperty() isExternal!: boolean;
}
