import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LibraryMember, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import {
  ListMembersQueryDto,
  MemberDto,
  UpdateMemberStatusDto,
} from './dto/member.dto';
import { MemberResponseDto } from './dto/library-response.dto';

/**
 * `frontend/src/features/library/api.ts`'s members surface (`modules/library.md` "Members: link
 * to students/staff ... don't duplicate person records"). `personId` is validated against the
 * real `Student`/`Teacher` table (whichever `memberType` says) but not joined on every read —
 * `personLabel` is the client-supplied denormalized snapshot `MemberForm`'s own search already
 * resolved, same discipline as `DocumentVersion.uploadedByLabel`.
 */
@Injectable()
export class LibraryMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListMembersQueryDto,
  ): Promise<PagedResult<MemberResponseDto>> {
    const where: Prisma.LibraryMemberWhereInput = {
      ...(query.memberType ? { memberType: query.memberType } : {}),
      ...(query.search
        ? { personLabel: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.libraryMember.findMany({
          where,
          orderBy: { personLabel: 'asc' },
          skip,
          take,
        }),
      () => this.prisma.libraryMember.count({ where }),
    );
    return {
      items: await Promise.all(result.items.map((m) => this.toResponse(m))),
      total: result.total,
    };
  }

  async create(dto: MemberDto): Promise<MemberResponseDto> {
    await this.assertPersonExists(dto.memberType, dto.personId);
    const existing = await this.prisma.libraryMember.findFirst({
      where: { memberType: dto.memberType, personId: dto.personId },
    });
    if (existing) {
      throw new BadRequestException('This person is already a library member');
    }
    const member = await this.prisma.libraryMember.create({
      data: {
        memberType: dto.memberType,
        personId: dto.personId,
        personLabel: dto.personLabel,
        maxBooks: dto.maxBooks,
        loanPeriodDays: dto.loanPeriodDays,
      } as unknown as Prisma.LibraryMemberUncheckedCreateInput,
    });
    return this.toResponse(member);
  }

  async updateStatus(
    id: string,
    dto: UpdateMemberStatusDto,
  ): Promise<MemberResponseDto> {
    await this.findOrThrow(id);
    const member = await this.prisma.libraryMember.update({
      where: { id },
      data: { status: dto.status },
    });
    return this.toResponse(member);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    const activeLoans = await this.prisma.loan.count({
      where: { memberId: id, returnedAt: null },
    });
    if (activeLoans > 0) {
      throw new BadRequestException(
        `Member ${id} has ${activeLoans} book(s) still on loan and cannot be removed`,
      );
    }
    await this.prisma.libraryMember.delete({ where: { id } });
  }

  /** Real `LibraryMember` row, for `LibraryCirculationService`/`LibraryReservationsService`. */
  async findEntityOrThrow(id: string): Promise<LibraryMember> {
    return this.findOrThrow(id);
  }

  /**
   * Read-side counterpart to `findOrCreateForStudent` — a student who has never reserved/borrowed
   * anything has no `LibraryMember` row yet, and a read shouldn't provision one just to answer
   * "you have no loans/reservations" (`null` here, not a 404, means exactly that empty state).
   */
  async findByStudentId(studentId: string): Promise<LibraryMember | null> {
    return this.prisma.libraryMember.findFirst({
      where: { memberType: 'student', personId: studentId },
    });
  }

  /**
   * The `'me'`-idiom counterpart for a self-service portal reservation
   * (`modules/library.md` "Portal: self-service reservations"): finds this student's existing
   * membership, or provisions one with sensible defaults on first use — the portal never learns
   * its own `LibraryMember.id`, so nothing else creates this row for them ahead of time.
   * `maxBooks`/`loanPeriodDays` mirror `MemberForm`'s own defaults (`schemas.ts`'s form
   * `DEFAULTS`), since no other source of truth for a student's lending limits exists until a
   * librarian sets one explicitly via `updateStatus`/a future member-edit endpoint.
   */
  async findOrCreateForStudent(studentId: string): Promise<LibraryMember> {
    const existing = await this.prisma.libraryMember.findFirst({
      where: { memberType: 'student', personId: studentId },
    });
    if (existing) return existing;

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }
    return this.prisma.libraryMember.create({
      data: {
        memberType: 'student',
        personId: studentId,
        personLabel: `${student.name} (#${student.admissionNumber})`,
        maxBooks: 3,
        loanPeriodDays: 14,
      } as unknown as Prisma.LibraryMemberUncheckedCreateInput,
    });
  }

  private async assertPersonExists(
    memberType: 'student' | 'teacher',
    personId: string,
  ): Promise<void> {
    const found =
      memberType === 'student'
        ? await this.prisma.student.findUnique({ where: { id: personId } })
        : await this.prisma.teacher.findUnique({ where: { id: personId } });
    if (!found) {
      throw new BadRequestException(
        `${memberType === 'student' ? 'Student' : 'Teacher'} ${personId} not found`,
      );
    }
  }

  private async findOrThrow(id: string): Promise<LibraryMember> {
    const member = await this.prisma.libraryMember.findUnique({
      where: { id },
    });
    if (!member) {
      throw new NotFoundException(`Member ${id} not found`);
    }
    return member;
  }

  private async toResponse(member: LibraryMember): Promise<MemberResponseDto> {
    const [activeLoans, outstandingFines] = await Promise.all([
      this.prisma.loan.count({
        where: { memberId: member.id, returnedAt: null },
      }),
      this.prisma.loan.aggregate({
        where: { memberId: member.id, fineStatus: 'pending' },
        _sum: { fineAmount: true },
      }),
    ]);
    return {
      id: member.id,
      memberType: member.memberType,
      personId: member.personId,
      personLabel: member.personLabel,
      maxBooks: member.maxBooks,
      loanPeriodDays: member.loanPeriodDays,
      status: member.status,
      activeLoans,
      outstandingFines: outstandingFines._sum.fineAmount ?? 0,
    };
  }
}
