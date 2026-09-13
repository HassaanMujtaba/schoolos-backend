import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';

/**
 * `GET /ptm/availability` — `teacherId` accepts a real `Teacher.id` (`PtmBookingFlow`'s own
 * `useTeachersQuery` lookup) or the `'me'` idiom; `PtmSlotManager`'s own read-side call currently
 * sends `session.user.id` instead of either, a known frontend mismatch flagged in
 * `../../../implementation-plan.md`'s Phase 7.7 section, not something this endpoint works around.
 */
export class PtmAvailabilityQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  onlyAvailable?: string;
}
