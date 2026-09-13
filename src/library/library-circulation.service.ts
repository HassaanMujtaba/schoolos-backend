import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Book, BookCopy, Loan, LibraryMember, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { resolveStudentId } from '../common/identity/resolve-me';
import { LibraryMembersService } from './library-members.service';
import { LibrarySettingsService } from './library-settings.service';
import {
  IssueBookDto,
  ListFinesQueryDto,
  LookupCopyQueryDto,
  ReturnBookDto,
} from './dto/circulation.dto';
import {
  CirculationLookupResponseDto,
  LoanResponseDto,
} from './dto/library-response.dto';
import { calculateDueDate, calculateFine } from './lib/loan-calc';
import {
  findNextReservation,
  reservationResponseOf,
} from './library-reservations.shared';

type LoanWithRelations = Loan & {
  copy: BookCopy & { book: Book };
  member: LibraryMember;
};

/**
 * `frontend/src/features/library/api.ts`'s circulation surface (`modules/library.md`
 * "Circulation: scan-to-issue/return, due dates, fines"). Resolves that module doc's barcode
 * open question as keyboard-wedge scanner input — `lookupByBarcode` just takes a plain string,
 * same as `api.ts`'s own top comment.
 */
@Injectable()
export class LibraryCirculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly members: LibraryMembersService,
    private readonly settings: LibrarySettingsService,
  ) {}

  async lookupByBarcode(
    query: LookupCopyQueryDto,
  ): Promise<CirculationLookupResponseDto> {
    const copy = await this.prisma.bookCopy.findFirst({
      where: { barcode: query.barcode },
      include: { book: true },
    });
    if (!copy) {
      throw new NotFoundException(`No copy matches barcode "${query.barcode}"`);
    }

    const activeLoan =
      copy.status === 'issued'
        ? await this.prisma.loan.findFirst({
            where: { copyId: copy.id, returnedAt: null },
            include: { copy: { include: { book: true } }, member: true },
          })
        : null;

    const nextReservation =
      copy.status === 'available'
        ? await findNextReservation(this.prisma, copy.bookId)
        : null;

    return {
      copy: {
        id: copy.id,
        bookId: copy.bookId,
        barcode: copy.barcode,
        status: copy.status,
      },
      book: {
        id: copy.book.id,
        title: copy.book.title,
        author: copy.book.author,
      },
      activeLoan: activeLoan ? this.toLoanResponse(activeLoan) : null,
      // The oldest pending reservation is always rank 1 by definition — no separate count needed.
      nextReservation: nextReservation
        ? reservationResponseOf(nextReservation, 1)
        : null,
    };
  }

  async issueBook(dto: IssueBookDto): Promise<LoanResponseDto> {
    const copy = await this.prisma.bookCopy.findUnique({
      where: { id: dto.copyId },
    });
    if (!copy) {
      throw new NotFoundException(`Copy ${dto.copyId} not found`);
    }
    if (copy.status !== 'available') {
      throw new ConflictException(
        `Copy ${dto.copyId} is ${copy.status}, not available to issue`,
      );
    }
    const member = await this.members.findEntityOrThrow(dto.memberId);
    if (member.status !== 'active') {
      throw new BadRequestException(`Member ${dto.memberId} is suspended`);
    }
    const activeLoans = await this.prisma.loan.count({
      where: { memberId: member.id, returnedAt: null },
    });
    if (activeLoans >= member.maxBooks) {
      throw new BadRequestException(
        `Member has reached their limit of ${member.maxBooks} book(s) on loan`,
      );
    }

    const issuedAt = parseDateOnly(formatDateOnly(new Date()));
    const dueAt = calculateDueDate(issuedAt, member.loanPeriodDays);

    const [loan] = await this.prisma.$transaction([
      this.prisma.loan.create({
        data: {
          copyId: copy.id,
          memberId: member.id,
          issuedAt,
          dueAt,
        } as unknown as Prisma.LoanUncheckedCreateInput,
        include: { copy: { include: { book: true } }, member: true },
      }),
      this.prisma.bookCopy.update({
        where: { id: copy.id },
        data: { status: 'issued' },
      }),
    ]);
    return this.toLoanResponse(loan);
  }

  async returnBook(dto: ReturnBookDto): Promise<LoanResponseDto> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: dto.loanId },
      include: { copy: { include: { book: true } }, member: true },
    });
    if (!loan) {
      throw new NotFoundException(`Loan ${dto.loanId} not found`);
    }
    if (loan.returnedAt) {
      throw new ConflictException(`Loan ${dto.loanId} was already returned`);
    }

    const settings = await this.settings.getEntity();
    const returnedAt = parseDateOnly(formatDateOnly(new Date()));
    const fineAmount = calculateFine(
      loan.dueAt,
      returnedAt,
      settings.finePerDayRate,
      settings.maxFine,
    );
    const fineStatus = fineAmount > 0 ? 'pending' : 'none';
    const copyStatus = dto.condition === 'ok' ? 'available' : dto.condition;

    const [updatedLoan] = await this.prisma.$transaction([
      this.prisma.loan.update({
        where: { id: loan.id },
        data: {
          returnedAt,
          returnCondition: dto.condition,
          fineAmount,
          fineStatus,
        },
        include: { copy: { include: { book: true } }, member: true },
      }),
      this.prisma.bookCopy.update({
        where: { id: loan.copyId },
        data: { status: copyStatus },
      }),
    ]);
    return this.toLoanResponse(updatedLoan);
  }

  async listFines(
    query: ListFinesQueryDto,
  ): Promise<PagedResult<LoanResponseDto>> {
    const where: Prisma.LoanWhereInput = {
      fineStatus: { not: 'none' },
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.search
        ? {
            member: {
              personLabel: { contains: query.search, mode: 'insensitive' },
            },
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.loan.findMany({
          where,
          include: { copy: { include: { book: true } }, member: true },
          orderBy: { issuedAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.loan.count({ where }),
    );
    return {
      items: result.items.map((l) => this.toLoanResponse(l)),
      total: result.total,
    };
  }

  async payFine(loanId: string): Promise<LoanResponseDto> {
    return this.settleFine(loanId, 'paid');
  }

  async waiveFine(loanId: string): Promise<LoanResponseDto> {
    return this.settleFine(loanId, 'waived');
  }

  /** Portal: `GET /library/loans?studentId=` — this student's current + past loans. */
  async listLoansForStudent(rawStudentId: string): Promise<LoanResponseDto[]> {
    const studentId = await resolveStudentId(
      this.prisma,
      rawStudentId,
      this.requestContext.userId,
    );
    const member = await this.members.findByStudentId(studentId);
    if (!member) return [];
    const loans = await this.prisma.loan.findMany({
      where: { memberId: member.id },
      include: { copy: { include: { book: true } }, member: true },
      orderBy: { issuedAt: 'desc' },
    });
    return loans.map((l) => this.toLoanResponse(l));
  }

  private async settleFine(
    loanId: string,
    status: 'paid' | 'waived',
  ): Promise<LoanResponseDto> {
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
    if (!loan) {
      throw new NotFoundException(`Loan ${loanId} not found`);
    }
    if (loan.fineStatus !== 'pending') {
      throw new ConflictException(
        `Loan ${loanId} has no pending fine to ${status === 'paid' ? 'pay' : 'waive'}`,
      );
    }
    const updated = await this.prisma.loan.update({
      where: { id: loanId },
      data: { fineStatus: status },
      include: { copy: { include: { book: true } }, member: true },
    });
    return this.toLoanResponse(updated);
  }

  private toLoanResponse(loan: LoanWithRelations): LoanResponseDto {
    return {
      id: loan.id,
      copyId: loan.copyId,
      bookId: loan.copy.bookId,
      bookTitle: loan.copy.book.title,
      memberId: loan.memberId,
      memberLabel: loan.member.personLabel,
      issuedAt: formatDateOnly(loan.issuedAt),
      dueAt: formatDateOnly(loan.dueAt),
      returnedAt: loan.returnedAt ? formatDateOnly(loan.returnedAt) : null,
      fineAmount: loan.fineAmount,
      fineStatus: loan.fineStatus,
    };
  }
}
