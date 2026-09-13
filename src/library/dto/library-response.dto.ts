import { ApiProperty } from '@nestjs/swagger';
import {
  CopyStatus,
  FineStatus,
  LibraryMemberStatus,
  LibraryMemberType,
  ReservationStatus,
} from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/library/api.ts`'s `LibraryCategory`/`LibraryShelf`. */
export class ReferenceEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** `api.ts`'s `Book`. `totalCopies`/`availableCopies` are server-computed (`schema.prisma`'s own doc comment). */
export class BookResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() isbn!: string;
  @ApiProperty() author!: string;
  @ApiProperty() publisher!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() shelfId!: string;
  @ApiProperty() edition!: string;
  @ApiProperty() description!: string;
  @ApiProperty() totalCopies!: number;
  @ApiProperty() availableCopies!: number;
}

export class PagedBooksDto implements PagedResult<BookResponseDto> {
  @ApiProperty({ type: [BookResponseDto] }) items!: BookResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `BookCopy`. */
export class CopyResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookId!: string;
  @ApiProperty() barcode!: string;
  @ApiProperty({ enum: CopyStatus }) status!: CopyStatus;
}

/** `api.ts`'s `LibraryMember`. */
export class MemberResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: LibraryMemberType }) memberType!: LibraryMemberType;
  @ApiProperty() personId!: string;
  @ApiProperty() personLabel!: string;
  @ApiProperty() maxBooks!: number;
  @ApiProperty() loanPeriodDays!: number;
  @ApiProperty({ enum: LibraryMemberStatus }) status!: LibraryMemberStatus;
  @ApiProperty() activeLoans!: number;
  @ApiProperty() outstandingFines!: number;
}

export class PagedMembersDto implements PagedResult<MemberResponseDto> {
  @ApiProperty({ type: [MemberResponseDto] }) items!: MemberResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `Loan`. `bookId`/`bookTitle`/`memberLabel` are always resolved server-side. */
export class LoanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() copyId!: string;
  @ApiProperty() bookId!: string;
  @ApiProperty() bookTitle!: string;
  @ApiProperty() memberId!: string;
  @ApiProperty() memberLabel!: string;
  @ApiProperty() issuedAt!: string;
  @ApiProperty() dueAt!: string;
  @ApiProperty({ nullable: true, type: String }) returnedAt!: string | null;
  @ApiProperty() fineAmount!: number;
  @ApiProperty({ enum: FineStatus }) fineStatus!: FineStatus;
}

export class PagedLoansDto implements PagedResult<LoanResponseDto> {
  @ApiProperty({ type: [LoanResponseDto] }) items!: LoanResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `Reservation`. `queuePosition` is server-computed (`schema.prisma`'s own doc comment). */
export class ReservationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookId!: string;
  @ApiProperty() bookTitle!: string;
  @ApiProperty() memberId!: string;
  @ApiProperty() memberLabel!: string;
  @ApiProperty() reservedAt!: string;
  @ApiProperty({ enum: ReservationStatus }) status!: ReservationStatus;
  @ApiProperty() queuePosition!: number;
}

export class PagedReservationsDto implements PagedResult<ReservationResponseDto> {
  @ApiProperty({ type: [ReservationResponseDto] })
  items!: ReservationResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `CirculationLookup`. */
export class CirculationLookupResponseDto {
  @ApiProperty({ type: CopyResponseDto }) copy!: CopyResponseDto;
  @ApiProperty() book!: { id: string; title: string; author: string };
  @ApiProperty({ type: LoanResponseDto, nullable: true })
  activeLoan!: LoanResponseDto | null;
  @ApiProperty({ type: ReservationResponseDto, nullable: true })
  nextReservation!: ReservationResponseDto | null;
}

/** `api.ts`'s `LibrarySettings`. */
export class LibrarySettingsResponseDto {
  @ApiProperty() finePerDayRate!: number;
  @ApiProperty({ nullable: true, type: Number }) maxFine!: number | null;
}
