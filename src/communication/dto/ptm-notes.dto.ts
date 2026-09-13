import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** `ptmNotesSchema` — `PATCH /ptm/bookings/:id`'s body. */
export class PtmNotesDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  notes!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  followUpAction!: string;
}
