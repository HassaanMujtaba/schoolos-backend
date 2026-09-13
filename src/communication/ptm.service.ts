import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PtmSlot } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import {
  resolveStudentId,
  resolveTeacherId,
} from '../common/identity/resolve-me';
import { PtmSlotDto } from './dto/ptm-slot.dto';
import { PtmBookDto } from './dto/ptm-book.dto';
import { PtmNotesDto } from './dto/ptm-notes.dto';
import { PtmAvailabilityQueryDto } from './dto/ptm-availability-query.dto';
import { PtmMineQueryDto } from './dto/ptm-mine-query.dto';
import { PtmSlotResponseDto } from './dto/ptm-response.dto';
import { NotificationsService } from './notifications.service';

/**
 * §30 Parent-Teacher Meetings — a slot and its booking are the same row (module doc: "not two
 * entities"). `ptm.manage` gates slot create/delete/notes (teacher side, always self-scoped to
 * the caller's own resolved `Teacher` record, the `teacherId=me` idiom); `ptm.book` gates booking,
 * cancel is self-service (module doc "Roles & permissions": "both branch in-component on one
 * shared PtmPage"). `GET /ptm/availability` has no gate — read by both flows.
 */
@Injectable()
export class PtmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listAvailability(
    query: PtmAvailabilityQueryDto,
    currentUserId: string | null,
  ): Promise<PtmSlotResponseDto[]> {
    const teacherId = query.teacherId
      ? await resolveTeacherId(this.prisma, query.teacherId, currentUserId)
      : undefined;
    const where: Prisma.PtmSlotWhereInput = {
      ...(teacherId ? { teacherId } : {}),
      ...(query.onlyAvailable === 'true' ? { bookedByUserId: null } : {}),
    };
    const slots = await this.prisma.ptmSlot.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    return this.toResponses(slots);
  }

  async createSlot(
    dto: PtmSlotDto,
    user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto> {
    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('End time must be after start time');
    }
    const teacherId = await resolveTeacherId(this.prisma, 'me', user.id);
    const slot = await this.prisma.ptmSlot.create({
      data: {
        teacherId,
        date: parseDateOnly(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
      } as unknown as Prisma.PtmSlotUncheckedCreateInput,
    });
    return (await this.toResponses([slot]))[0];
  }

  async deleteSlot(id: string, user: AuthenticatedUser): Promise<void> {
    const slot = await this.findOrThrow(id);
    const teacherId = await resolveTeacherId(this.prisma, 'me', user.id);
    if (slot.teacherId !== teacherId) {
      throw new ForbiddenException('Not authorized to remove this slot');
    }
    await this.prisma.ptmSlot.delete({ where: { id } });
  }

  async book(
    dto: PtmBookDto,
    user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto> {
    const studentId = await resolveStudentId(
      this.prisma,
      dto.studentId,
      user.id,
    );
    await this.assertCanActForStudent(studentId, user);

    const slot = await this.findOrThrow(dto.slotId);
    if (slot.bookedByUserId) {
      throw new ConflictException('This slot has already been booked');
    }
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }

    const updated = await this.prisma.ptmSlot.update({
      where: { id: dto.slotId },
      data: {
        bookedByUserId: user.id,
        bookedByLabel: user.name,
        studentId,
        studentLabel: student.name,
      },
    });

    const teacher = await this.prisma.teacher.findUnique({
      where: { id: updated.teacherId },
    });
    if (teacher?.userId) {
      await this.notifications.notifyUser({
        userId: teacher.userId,
        type: 'ptm',
        title: `New PTM booking from ${user.name}`,
        body: `${formatDateOnly(updated.date)} ${updated.startTime}–${updated.endTime}`,
        linkHref: '/ptm',
      });
    }
    return (await this.toResponses([updated]))[0];
  }

  async cancelBooking(id: string, user: AuthenticatedUser): Promise<void> {
    const slot = await this.findOrThrow(id);
    if (!slot.bookedByUserId) {
      throw new ConflictException('This slot has no active booking to cancel');
    }
    if (slot.bookedByUserId !== user.id) {
      const teacherId = await resolveTeacherId(
        this.prisma,
        'me',
        user.id,
      ).catch(() => null);
      if (!teacherId || slot.teacherId !== teacherId) {
        throw new ForbiddenException('Not authorized to cancel this booking');
      }
    }
    await this.prisma.ptmSlot.update({
      where: { id },
      data: {
        bookedByUserId: null,
        bookedByLabel: null,
        studentId: null,
        studentLabel: null,
        notes: '',
        followUpAction: '',
      },
    });
  }

  async listMine(
    query: PtmMineQueryDto,
    user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto[]> {
    const studentId = query.studentId
      ? await resolveStudentId(this.prisma, query.studentId, user.id)
      : undefined;
    const slots = await this.prisma.ptmSlot.findMany({
      where: { bookedByUserId: user.id, ...(studentId ? { studentId } : {}) },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    return this.toResponses(slots);
  }

  async updateNotes(
    id: string,
    dto: PtmNotesDto,
    user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto> {
    const slot = await this.findOrThrow(id);
    const teacherId = await resolveTeacherId(this.prisma, 'me', user.id);
    if (slot.teacherId !== teacherId) {
      throw new ForbiddenException('Not authorized to edit this booking');
    }
    const updated = await this.prisma.ptmSlot.update({
      where: { id },
      data: { notes: dto.notes, followUpAction: dto.followUpAction },
    });
    return (await this.toResponses([updated]))[0];
  }

  // ---------------------------------------------------------------------

  private async findOrThrow(id: string): Promise<PtmSlot> {
    const slot = await this.prisma.ptmSlot.findUnique({ where: { id } });
    if (!slot) {
      throw new NotFoundException(`PTM slot ${id} not found`);
    }
    return slot;
  }

  /** Same shape as `LeaveService.assertCanActForStudent` — a Student booking their own meeting, or a Parent booking on behalf of a linked child. */
  private async assertCanActForStudent(
    studentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { userId: user.id },
    });
    if (student && student.id === studentId) return;

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
        'Not authorized to book a meeting for this student',
      );
    }
  }

  private async toResponses(slots: PtmSlot[]): Promise<PtmSlotResponseDto[]> {
    const teacherIds = [...new Set(slots.map((s) => s.teacherId))];
    const teachers = teacherIds.length
      ? await this.prisma.teacher.findMany({
          where: { id: { in: teacherIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(teachers.map((t) => [t.id, t.name]));
    return slots.map((s) => ({
      id: s.id,
      teacherId: s.teacherId,
      teacherLabel: nameById.get(s.teacherId) ?? '',
      date: formatDateOnly(s.date),
      startTime: s.startTime,
      endTime: s.endTime,
      bookedByParentId: s.bookedByUserId,
      bookedByParentLabel: s.bookedByLabel,
      studentLabel: s.studentLabel,
      notes: s.notes,
      followUpAction: s.followUpAction,
    }));
  }
}
