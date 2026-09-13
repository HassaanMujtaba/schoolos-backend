import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString } from 'class-validator';

/** `ptmSlotSchema` — `POST /ptm/slots`'s body. No `teacherId` field: always the caller's own resolved `Teacher` record (`PtmService.createSlot`'s own doc comment). */
export class PtmSlotDto {
  @ApiProperty({ example: '2026-09-07' })
  @IsDateString({ strict: false }, { message: 'Date is required' })
  date!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Start time is required' })
  startTime!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'End time is required' })
  endTime!: string;
}
