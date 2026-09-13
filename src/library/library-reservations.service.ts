import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { resolveStudentId } from '../common/identity/resolve-me';
import { LibraryCatalogService } from './library-catalog.service';
import { LibraryCirculationService } from './library-circulation.service';
import { LibraryMembersService } from './library-members.service';
import {
  CreateReservationDto,
  FulfillReservationDto,
  ListReservationsQueryDto,
} from './dto/reservation.dto';
import {
  LoanResponseDto,
  ReservationResponseDto,
} from './dto/library-response.dto';
import {
  computeQueuePosition,
  reservationResponseOf,
} from './library-reservations.shared';

/**
 * `frontend/src/features/library/api.ts`'s reservations surface (`modules/library.md` "Not
 * built: reservations", now resolved as a librarian-run FIFO queue, plus its own follow-on
 * "self-service portal reservations"). One endpoint serves both callers — see
 * `CreateReservationDto`'s own doc comment — so, like `attendance/leave.controller.ts`'s
 * `POST /leave/student`, `create`/`cancel` carry no route-level `@RequirePermission`: a librarian
 * caller (`memberId`) is checked against `library.circulate` here, a portal caller (`studentId`)
 * against the same self-or-linked-parent ownership `LeaveService.assertCanActForStudent` already
 * established.
 */
@Injectable()
export class LibraryReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: LibraryCatalogService,
    private readonly members: LibraryMembersService,
    private readonly circulation: LibraryCirculationService,
  ) {}

  async list(
    query: ListReservationsQueryDto,
    user: AuthenticatedUser,
  ): Promise<PagedResult<ReservationResponseDto>> {
    let memberId: string | undefined;
    if (query.studentId) {
      const studentId = await resolveStudentId(
        this.prisma,
        query.studentId,
        user.id,
      );
      const member = await this.members.findByStudentId(studentId);
      if (!member) return { items: [], total: 0 };
      memberId = member.id;
    } else if (!user.permissions.includes('library.circulate')) {
      throw new ForbiddenException('Missing permission: library.circulate');
    }

    const where: Prisma.ReservationWhereInput = {
      ...(query.bookId ? { bookId: query.bookId } : {}),
      ...(memberId ? { memberId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                book: {
                  title: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                member: {
                  personLabel: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.reservation.findMany({
          where,
          include: { book: true, member: true },
          orderBy: { createdAt: 'asc' },
          skip,
          take,
        }),
      () => this.prisma.reservation.count({ where }),
    );
    return {
      items: await Promise.all(
        result.items.map(async (r) =>
          reservationResponseOf(r, await computeQueuePosition(this.prisma, r)),
        ),
      ),
      total: result.total,
    };
  }

  async create(
    dto: CreateReservationDto,
    user: AuthenticatedUser,
  ): Promise<ReservationResponseDto> {
    if (Boolean(dto.memberId) === Boolean(dto.studentId)) {
      throw new BadRequestException(
        'Provide exactly one of memberId or studentId',
      );
    }

    const memberId = dto.memberId
      ? await this.resolveLibrarianMemberId(dto.memberId, user)
      : await this.resolvePortalMemberId(dto.studentId!, user);

    const book = await this.catalog.findBookEntityOrThrow(dto.bookId);
    const reservedAt = parseDateOnly(formatDateOnly(new Date()));

    const reservation = await this.prisma.reservation.create({
      data: {
        bookId: book.id,
        memberId,
        reservedAt,
      } as unknown as Prisma.ReservationUncheckedCreateInput,
      include: { book: true, member: true },
    });
    return reservationResponseOf(
      reservation,
      await computeQueuePosition(this.prisma, reservation),
    );
  }

  async cancel(id: string, user: AuthenticatedUser): Promise<void> {
    const reservation = await this.findOrThrow(id);
    if (reservation.status !== 'pending') {
      throw new ConflictException(
        `Reservation ${id} is already ${reservation.status}`,
      );
    }
    if (!user.permissions.includes('library.circulate')) {
      await this.assertCanActForStudent(reservation.member.personId, user);
    }
    await this.prisma.reservation.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  /**
   * `POST /library/reservations/:id/fulfill` — issues the copy to the reservation's member and
   * marks it fulfilled. Not a single DB transaction across both writes (`issueBook` already runs
   * its own `$transaction` for the loan+copy half) — a real, flagged limit, not an oversight: if
   * the reservation-status update below failed after a successful issue, the copy would already
   * be on loan with the reservation still `pending`, same "not a saga" trade-off this schema
   * otherwise avoids by keeping single-entity transactions atomic. Librarian-only, always.
   */
  async fulfill(
    id: string,
    dto: FulfillReservationDto,
  ): Promise<LoanResponseDto> {
    const reservation = await this.findOrThrow(id);
    if (reservation.status !== 'pending') {
      throw new ConflictException(
        `Reservation ${id} is already ${reservation.status}`,
      );
    }
    const loan = await this.circulation.issueBook({
      copyId: dto.copyId,
      memberId: reservation.memberId,
    });
    await this.prisma.reservation.update({
      where: { id },
      data: { status: 'fulfilled' },
    });
    return loan;
  }

  private async resolveLibrarianMemberId(
    memberId: string,
    user: AuthenticatedUser,
  ): Promise<string> {
    if (!user.permissions.includes('library.circulate')) {
      throw new ForbiddenException('Missing permission: library.circulate');
    }
    const member = await this.members.findEntityOrThrow(memberId);
    return member.id;
  }

  private async resolvePortalMemberId(
    rawStudentId: string,
    user: AuthenticatedUser,
  ): Promise<string> {
    const studentId = await resolveStudentId(
      this.prisma,
      rawStudentId,
      user.id,
    );
    await this.assertCanActForStudent(studentId, user);
    const member = await this.members.findOrCreateForStudent(studentId);
    return member.id;
  }

  /** Same self-or-linked-parent ownership check as `LeaveService.assertCanActForStudent`. */
  private async assertCanActForStudent(
    studentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.permissions.includes('library.circulate')) return;

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (student?.userId === user.id) return;

    const parent = await this.prisma.parent.findUnique({
      where: { userId: user.id },
    });
    const link = parent
      ? await this.prisma.parentStudentLink.findFirst({
          where: { parentId: parent.id, studentId },
        })
      : null;
    if (!link) {
      throw new ForbiddenException(
        'Not authorized to act on behalf of this student',
      );
    }
  }

  private async findOrThrow(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { book: true, member: true },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return reservation;
  }
}
