import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

/** `EventListParams` — `GET /events?from=&to=`, an inclusive range; `CalendarView` always requests the visible month. */
export class EventListQueryDto {
  @ApiProperty({ example: '2026-09-01' })
  @IsDateString({ strict: false }, { message: 'from is required' })
  from!: string;

  @ApiProperty({ example: '2026-09-30' })
  @IsDateString({ strict: false }, { message: 'to is required' })
  to!: string;
}
