import { Book, LibraryMember, Reservation } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { formatDateOnly } from '../common/dates/date-only';
import { ReservationResponseDto } from './dto/library-response.dto';

export type ReservationWithRelations = Reservation & {
  book: Book;
  member: LibraryMember;
};

/**
 * Shared FIFO-queue helpers used by both `LibraryCirculationService` (the "reserved for ..."
 * banner) and `LibraryReservationsService` (the reservations tab itself) — split out to a plain
 * function module, not a shared injectable service, so neither service needs to depend on the
 * other just for this (avoids a DI cycle: `ReservationsService.fulfill` already depends on
 * `CirculationService.issueBook`-equivalent logic the other direction).
 *
 * Queue order is `createdAt`, not the date-only `reservedAt` (`schema.prisma`'s own doc comment)
 * — same-day reservations would otherwise tie under `reservedAt`'s day-only granularity.
 */

export async function findNextReservation(
  prisma: PrismaService,
  bookId: string,
): Promise<ReservationWithRelations | null> {
  return prisma.reservation.findFirst({
    where: { bookId, status: 'pending' },
    include: { book: true, member: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** 1-indexed rank among `pending` reservations for the same book; 0 once no longer queued. */
export async function computeQueuePosition(
  prisma: PrismaService,
  reservation: Reservation,
): Promise<number> {
  if (reservation.status !== 'pending') return 0;
  const earlier = await prisma.reservation.count({
    where: {
      bookId: reservation.bookId,
      status: 'pending',
      createdAt: { lt: reservation.createdAt },
    },
  });
  return earlier + 1;
}

export function reservationResponseOf(
  reservation: ReservationWithRelations,
  queuePosition: number,
): ReservationResponseDto {
  return {
    id: reservation.id,
    bookId: reservation.bookId,
    bookTitle: reservation.book.title,
    memberId: reservation.memberId,
    memberLabel: reservation.member.personLabel,
    reservedAt: formatDateOnly(reservation.reservedAt),
    status: reservation.status,
    queuePosition,
  };
}
