import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Event as EventModel,
  EventType as PrismaEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { EventDto, EventTypeWire } from './dto/event.dto';
import { EventListQueryDto } from './dto/event-list-query.dto';
import { EventResponseDto } from './dto/event-response.dto';

const WIRE_TO_PRISMA: Record<EventTypeWire, PrismaEventType> = {
  holiday: 'holiday',
  exam: 'exam',
  ptm: 'ptm',
  'sports-day': 'sports_day',
  'annual-function': 'annual_function',
  'field-trip': 'field_trip',
  meeting: 'meeting',
  other: 'other',
};

const PRISMA_TO_WIRE: Record<PrismaEventType, EventTypeWire> = {
  holiday: 'holiday',
  exam: 'exam',
  ptm: 'ptm',
  sports_day: 'sports-day',
  annual_function: 'annual-function',
  field_trip: 'field-trip',
  meeting: 'meeting',
  other: 'other',
};

/**
 * §29 school calendar. `events.manage` gates create/update/delete; `GET /events` has no gate at
 * all (module doc "Roles & permissions": "viewing the calendar has no permission at all — common
 * information everyone reads"). `list` merges three sources for a `[from, to]` range: this
 * module's own `Event` rows, `Holiday` (`isExternal`, school-wide), and `Exam` (`isExternal`,
 * scoped to its own class) — the latter two are read-only mirrors, never written here.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: EventListQueryDto): Promise<EventResponseDto[]> {
    const range = {
      gte: parseDateOnly(query.from),
      lte: parseDateOnly(query.to),
    };

    const [events, holidays, exams] = await Promise.all([
      this.prisma.event.findMany({
        where: { date: range },
        orderBy: { date: 'asc' },
      }),
      this.prisma.holiday.findMany({
        where: { date: range },
        orderBy: { date: 'asc' },
      }),
      this.prisma.exam.findMany({
        where: { date: range },
        orderBy: { date: 'asc' },
      }),
    ]);

    const subjectIds = [...new Set(exams.map((e) => e.subjectId))];
    const subjects = subjectIds.length
      ? await this.prisma.subject.findMany({
          where: { id: { in: subjectIds } },
          select: { id: true, name: true },
        })
      : [];
    const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

    const fromEvents = events.map(toEventResponse);
    const fromHolidays: EventResponseDto[] = holidays.map((h) => ({
      id: `holiday-${h.id}`,
      title: h.name,
      type: 'holiday',
      date: formatDateOnly(h.date),
      startTime: '',
      endTime: '',
      location: '',
      description: '',
      audience: 'school',
      classIds: [],
      isExternal: true,
    }));
    const fromExams: EventResponseDto[] = exams.map((e) => ({
      id: `exam-${e.id}`,
      title: `${capitalize(e.type)} — ${subjectNameById.get(e.subjectId) ?? 'Exam'}`,
      type: 'exam',
      date: formatDateOnly(e.date),
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.room,
      description: '',
      audience: 'class',
      classIds: [e.classId],
      isExternal: true,
    }));

    return [...fromEvents, ...fromHolidays, ...fromExams].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  async create(dto: EventDto): Promise<EventResponseDto> {
    const classIds = dto.audience === 'class' ? dto.classIds : [];
    await this.assertClassesExist(classIds);
    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        type: WIRE_TO_PRISMA[dto.type],
        date: parseDateOnly(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        description: dto.description,
        audience: dto.audience,
        classIds,
      } as unknown as Prisma.EventUncheckedCreateInput,
    });
    return toEventResponse(event);
  }

  async update(id: string, dto: EventDto): Promise<EventResponseDto> {
    await this.findOrThrow(id);
    const classIds = dto.audience === 'class' ? dto.classIds : [];
    await this.assertClassesExist(classIds);
    const event = await this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        type: WIRE_TO_PRISMA[dto.type],
        date: parseDateOnly(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
        location: dto.location,
        description: dto.description,
        audience: dto.audience,
        classIds,
      },
    });
    return toEventResponse(event);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.event.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<EventModel> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException(
        `Event ${id} not found — isExternal holiday/exam entries aren't real rows here and can't be edited or deleted`,
      );
    }
    return event;
  }

  private async assertClassesExist(classIds: string[]): Promise<void> {
    if (classIds.length === 0) return;
    const found = await this.prisma.schoolClass.findMany({
      where: { id: { in: classIds } },
      select: { id: true },
    });
    const missing = classIds.filter((id) => !found.some((c) => c.id === id));
    if (missing.length > 0) {
      throw new NotFoundException(`Class(es) not found: ${missing.join(', ')}`);
    }
  }
}

function toEventResponse(event: EventModel): EventResponseDto {
  return {
    id: event.id,
    title: event.title,
    type: PRISMA_TO_WIRE[event.type],
    date: formatDateOnly(event.date),
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    description: event.description,
    audience: event.audience,
    classIds: event.classIds,
    isExternal: false,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
