import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** `GET /ptm/bookings/mine?studentId=` — narrows to one linked child; supports the `'me'` idiom. */
export class PtmMineQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}
