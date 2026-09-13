import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * `GET /library/loans?studentId=` — `api.ts`'s `listLoansForStudent`. Portal-only, deliberately
 * not paginated (a plain `Loan[]`, not `PagedResult`) — same "one page comfortably covers a single
 * member's history" call `listReservationsForStudent` makes.
 */
export class ListLoansQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  studentId!: string;
}
