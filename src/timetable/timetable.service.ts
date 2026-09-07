import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Substitution, TimetableEntry } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { parseDateOnly, formatDateOnly } from '../common/dates/date-only';
import { resolveTeacherId } from '../common/identity/resolve-me';
import { TimetableEntryDto } from './dto/timetable-entry.dto';
import { ListTimetableQueryDto } from './dto/list-timetable-query.dto';
import { SubstitutionDto } from './dto/substitution.dto';
import { GenerateTimetableDto } from './dto/generate-timetable.dto';
import {
  SubstitutionResponseDto,
  TimetableEntryResponseDto,
} from './dto/timetable-response.dto';

// A reasonable school-day default — there's no school-configured period count/timing yet
// (`school-setup.md`'s deferred "school timings" config would own that, same gap
// `MAX_PERIODS_PER_DAY` in the frontend's own `constants.ts` flags). Only used by `generate()`
// below, not by the manual `SlotEditorDialog` CRUD path, which sends its own times.
const GENERATED_PERIODS_PER_DAY = 8;
const GENERATED_PERIOD_LENGTH_MINUTES = 40;
const GENERATED_DAY_START_MINUTES = 8 * 60; // 08:00
const GENERATED_DAYS = [0, 1, 2, 3, 4, 5]; // Monday–Saturday, matches `TimetableEntry.dayOfWeek`'s own doc comment

/**
 * `frontend/src/features/timetable/api.ts`'s surface — §12. Conflict detection (teacher/room/
 * class/subject) is deliberately **not** re-enforced server-side on the manual CRUD path — this
 * mirrors `timetable.md`'s own resolved decision ("Conflict-check endpoint: not needed — client-
 * side validation... is what shipped"), not an oversight; `SlotEditorDialog` never calls `onSubmit`
 * while `lib/conflicts.ts` reports one. `generate()` below does avoid teacher double-booking
 * itself, since nothing client-side reviews its output before it's already saved.
 */
@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async list(
    query: ListTimetableQueryDto,
  ): Promise<TimetableEntryResponseDto[]> {
    const teacherId = query.teacherId
      ? await resolveTeacherId(
          this.prisma,
          query.teacherId,
          this.requestContext.userId,
        )
      : undefined;

    const where: Prisma.TimetableEntryWhereInput = {
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(query.roomId ? { roomId: query.roomId } : {}),
    };

    const entries = await this.prisma.timetableEntry.findMany({
      where,
      orderBy: [{ dayOfWeek: 'asc' }, { periodIndex: 'asc' }],
    });
    return entries.map(toEntryResponse);
  }

  /**
   * The full, unfiltered collection — `lib/conflicts.ts`'s cross-class conflict checking needs to
   * see every entry, not just one class/teacher/room's slice.
   */
  async listAll(): Promise<TimetableEntryResponseDto[]> {
    const entries = await this.prisma.timetableEntry.findMany({
      orderBy: [{ dayOfWeek: 'asc' }, { periodIndex: 'asc' }],
    });
    return entries.map(toEntryResponse);
  }

  async createEntry(
    dto: TimetableEntryDto,
  ): Promise<TimetableEntryResponseDto> {
    await this.assertEntryTargetValid(dto);
    const entry = await this.prisma.timetableEntry.create({
      data: toEntryData(
        dto,
      ) as unknown as Prisma.TimetableEntryUncheckedCreateInput,
    });
    return toEntryResponse(entry);
  }

  async updateEntry(
    id: string,
    dto: TimetableEntryDto,
  ): Promise<TimetableEntryResponseDto> {
    await this.findEntryOrThrow(id);
    await this.assertEntryTargetValid(dto);
    const entry = await this.prisma.timetableEntry.update({
      where: { id },
      data: toEntryData(dto),
    });
    return toEntryResponse(entry);
  }

  async removeEntry(id: string): Promise<void> {
    await this.findEntryOrThrow(id);
    await this.prisma.timetableEntry.delete({ where: { id } });
  }

  /**
   * `POST /timetable/generate` — §12's "automatic generation." This is a simple round-robin
   * filler over each subject assigned to the class (via `TeacherAssignment`), **not** a real
   * constraint solver: it walks day×period slots in order, skipping a slot only when the subject's
   * assigned teacher is already booked elsewhere at that exact slot (tenant-wide), and otherwise
   * never optimizes for gaps, subject spread across the week, or teacher workload balance. Flagged
   * here loudly, not hidden, the same honesty standard as the admissions `enroll()` interim
   * defaults and the documents malware-scan stub — a real solver is a follow-up, not this pass's
   * scope. Replaces every currently-scheduled period for this class/section, per `timetable.md`'s
   * own contract ("it replaces every currently-scheduled period for that class/section").
   */
  async generate(
    dto: GenerateTimetableDto,
  ): Promise<TimetableEntryResponseDto[]> {
    const [section, subjects] = await Promise.all([
      this.prisma.section.findUnique({ where: { id: dto.sectionId } }),
      this.prisma.subject.findMany({
        where: { classIds: { has: dto.classId } },
      }),
    ]);
    if (!section || section.classId !== dto.classId) {
      throw new BadRequestException(
        `Section ${dto.sectionId} not found in class ${dto.classId}`,
      );
    }

    const assignments = await this.prisma.teacherAssignment.findMany({
      where: {
        classId: dto.classId,
        sectionId: dto.sectionId,
        subjectId: { in: subjects.map((s) => s.id) },
      },
    });
    const teacherBySubject = new Map(
      assignments.map((a) => [a.subjectId, a.teacherId]),
    );
    // Only subjects with a real teacher assignment can be scheduled — assigning an arbitrary
    // teacher would silently invent data nobody confirmed, the same "never guess" standard
    // `admissions.service.ts`'s `enroll()` applies to its own interim defaults.
    const schedulable = subjects.filter((s) => teacherBySubject.has(s.id));
    if (schedulable.length === 0) {
      throw new BadRequestException(
        `No subject in class ${dto.classId} has a teacher assignment for section ${dto.sectionId} yet — assign teachers first`,
      );
    }

    // Existing tenant-wide entries (excluding this class/section's own, which are about to be
    // replaced) — used only to avoid double-booking a teacher who already teaches elsewhere at a
    // given day/period.
    const otherEntries = await this.prisma.timetableEntry.findMany({
      where: {
        NOT: { classId: dto.classId, sectionId: dto.sectionId },
      },
      select: { dayOfWeek: true, periodIndex: true, teacherId: true },
    });
    const teacherBusy = new Set(
      otherEntries.map((e) => `${e.dayOfWeek}:${e.periodIndex}:${e.teacherId}`),
    );

    // `tenantId` is injected by PrismaService's tenant-scoping extension at `createMany` time
    // (`stampTenantId`'s array branch) — omitted here structurally, same `as unknown as` cast
    // `StudentsService.create`'s nested `enrollments` payload already uses for the same reason.
    const generated: Omit<Prisma.TimetableEntryCreateManyInput, 'tenantId'>[] =
      [];
    let cursor = 0;
    for (const day of GENERATED_DAYS) {
      for (let period = 0; period < GENERATED_PERIODS_PER_DAY; period++) {
        const subject = schedulable[cursor % schedulable.length];
        const teacherId = teacherBySubject.get(subject.id)!;
        if (teacherBusy.has(`${day}:${period}:${teacherId}`)) {
          // Leave this slot empty rather than double-book — an honest gap, not a silent conflict.
          cursor++;
          continue;
        }
        const startMinutes =
          GENERATED_DAY_START_MINUTES +
          period * GENERATED_PERIOD_LENGTH_MINUTES;
        generated.push({
          classId: dto.classId,
          sectionId: dto.sectionId,
          subjectId: subject.id,
          teacherId,
          roomId: section.roomLabel,
          dayOfWeek: day,
          periodIndex: period,
          startTime: formatMinutes(startMinutes),
          endTime: formatMinutes(
            startMinutes + GENERATED_PERIOD_LENGTH_MINUTES,
          ),
        });
        cursor++;
      }
    }

    const entries = await this.prisma.$transaction(async (tx) => {
      await tx.timetableEntry.deleteMany({
        where: { classId: dto.classId, sectionId: dto.sectionId },
      });
      await tx.timetableEntry.createMany({
        data: generated as Prisma.TimetableEntryCreateManyInput[],
      });
      return tx.timetableEntry.findMany({
        where: { classId: dto.classId, sectionId: dto.sectionId },
        orderBy: [{ dayOfWeek: 'asc' }, { periodIndex: 'asc' }],
      });
    });

    return entries.map(toEntryResponse);
  }

  async listSubstitutions(date: string): Promise<SubstitutionResponseDto[]> {
    const substitutions = await this.prisma.substitution.findMany({
      where: { date: parseDateOnly(date) },
      orderBy: { periodIndex: 'asc' },
    });
    return substitutions.map(toSubstitutionResponse);
  }

  async createSubstitution(
    dto: SubstitutionDto,
  ): Promise<SubstitutionResponseDto> {
    const substitution = await this.prisma.substitution.create({
      data: {
        date: parseDateOnly(dto.date),
        classId: dto.classId,
        sectionId: dto.sectionId,
        periodIndex: dto.periodIndex,
        subjectId: dto.subjectId,
        originalTeacherId: dto.originalTeacherId,
        substituteTeacherId: dto.substituteTeacherId,
        reason: dto.reason,
      } as unknown as Prisma.SubstitutionUncheckedCreateInput,
    });
    return toSubstitutionResponse(substitution);
  }

  async removeSubstitution(id: string): Promise<void> {
    const substitution = await this.prisma.substitution.findUnique({
      where: { id },
    });
    if (!substitution) {
      throw new NotFoundException(`Substitution ${id} not found`);
    }
    await this.prisma.substitution.delete({ where: { id } });
  }

  private async findEntryOrThrow(id: string): Promise<TimetableEntry> {
    const entry = await this.prisma.timetableEntry.findUnique({
      where: { id },
    });
    if (!entry) {
      throw new NotFoundException(`Timetable entry ${id} not found`);
    }
    return entry;
  }

  private async assertEntryTargetValid(dto: TimetableEntryDto): Promise<void> {
    const [schoolClass, section, subject, teacher] = await Promise.all([
      this.prisma.schoolClass.findUnique({ where: { id: dto.classId } }),
      this.prisma.section.findUnique({ where: { id: dto.sectionId } }),
      this.prisma.subject.findUnique({ where: { id: dto.subjectId } }),
      this.prisma.teacher.findUnique({ where: { id: dto.teacherId } }),
    ]);
    if (!schoolClass) {
      throw new BadRequestException(`Class ${dto.classId} not found`);
    }
    if (!section || section.classId !== dto.classId) {
      throw new BadRequestException(
        `Section ${dto.sectionId} not found in class ${dto.classId}`,
      );
    }
    if (!subject) {
      throw new BadRequestException(`Subject ${dto.subjectId} not found`);
    }
    if (!teacher) {
      throw new BadRequestException(`Teacher ${dto.teacherId} not found`);
    }
  }
}

function toEntryData(dto: TimetableEntryDto) {
  return {
    classId: dto.classId,
    sectionId: dto.sectionId,
    subjectId: dto.subjectId,
    teacherId: dto.teacherId,
    roomId: dto.roomId,
    dayOfWeek: dto.dayOfWeek,
    periodIndex: dto.periodIndex,
    startTime: dto.startTime,
    endTime: dto.endTime,
  };
}

function toEntryResponse(entry: TimetableEntry): TimetableEntryResponseDto {
  return {
    id: entry.id,
    classId: entry.classId,
    sectionId: entry.sectionId,
    subjectId: entry.subjectId,
    teacherId: entry.teacherId,
    roomId: entry.roomId,
    dayOfWeek: entry.dayOfWeek,
    periodIndex: entry.periodIndex,
    startTime: entry.startTime,
    endTime: entry.endTime,
  };
}

function toSubstitutionResponse(
  substitution: Substitution,
): SubstitutionResponseDto {
  return {
    id: substitution.id,
    date: formatDateOnly(substitution.date),
    classId: substitution.classId,
    sectionId: substitution.sectionId,
    periodIndex: substitution.periodIndex,
    subjectId: substitution.subjectId,
    originalTeacherId: substitution.originalTeacherId,
    substituteTeacherId: substitution.substituteTeacherId,
    reason: substitution.reason,
  };
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
