import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** `POST /ptm/book`'s body. `studentId` supports the `'me'` idiom for a Student session (`PtmBookingFlow`'s own doc comment). */
export class PtmBookDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  slotId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  studentId!: string;
}
