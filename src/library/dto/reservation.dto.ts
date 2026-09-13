import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `POST /library/reservations` — `api.ts`'s `createReservation`/`createReservationForStudent`
 * share one endpoint: a librarian-run reservation supplies `memberId`, a portal self-service one
 * supplies `studentId` (resolved via the `'me'` idiom, `common/identity/resolve-me.ts`) instead —
 * `LibraryReservationsService.create` requires exactly one of the two, never both/neither.
 */
export class CreateReservationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  bookId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}

/** `POST /library/reservations/:id/fulfill` — `api.ts`'s `fulfillReservation`. */
export class FulfillReservationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  copyId!: string;
}

/** `GET /library/reservations?bookId=&studentId=` — `api.ts`'s `ReservationListParams`. */
export class ListReservationsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bookId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}
