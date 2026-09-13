import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Teacher, TeacherAssignment } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { resolveTeacherId } from '../common/identity/resolve-me';
import { TeacherDto } from './dto/teacher.dto';
import { AssignmentDto } from './dto/assignment.dto';
import {
  AssignmentResponseDto,
  TeacherResponseDto,
} from './dto/teacher-response.dto';
import { TeacherDashboardDto } from './dto/teacher-dashboard.dto';

const SORTABLE_FIELDS = ['name', 'employeeId', 'createdAt'] as const;

/** `frontend/src/features/teachers/api.ts`'s surface — §10, admin CRUD + subject/class/section
 * assignment, plus `getMyDashboard` below (`GET /teachers/me/dashboard`), which aggregates
 * Timetable/Attendance/Homework/Examinations data now that those Phase 4 modules exist. */
@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQueryDto): Promise<PagedResult<TeacherResponseDto>> {
    const where: Prisma.TeacherWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { employeeId: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.teacher.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.teacher.count({ where }),
    );

    return {
      items: await Promise.all(result.items.map((t) => this.toResponse(t))),
      total: result.total,
    };
  }

  async get(id: string): Promise<TeacherResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async create(dto: TeacherDto): Promise<TeacherResponseDto> {
    await this.assertSubjectsExist(dto.subjectIds);
    const teacher = await this.wrapUniqueViolation(dto.employeeId, () =>
      this.prisma.teacher.create({
        data: toTeacherData(
          dto,
        ) as unknown as Prisma.TeacherUncheckedCreateInput,
      }),
    );
    return this.toResponse(teacher);
  }

  async update(id: string, dto: TeacherDto): Promise<TeacherResponseDto> {
    await this.findOrThrow(id);
    await this.assertSubjectsExist(dto.subjectIds);
    const teacher = await this.wrapUniqueViolation(dto.employeeId, () =>
      this.prisma.teacher.update({ where: { id }, data: toTeacherData(dto) }),
    );
    return this.toResponse(teacher);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.teacher.delete({ where: { id } });
  }

  async listAssignments(teacherId: string): Promise<AssignmentResponseDto[]> {
    await this.findOrThrow(teacherId);
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { teacherId },
    });
    return assignments.map(toAssignmentResponse);
  }

  async assign(
    teacherId: string,
    dto: AssignmentDto,
  ): Promise<AssignmentResponseDto> {
    await this.findOrThrow(teacherId);
    await this.assertAssignmentTargetValid(dto);

    const assignment = await this.prisma.teacherAssignment.create({
      data: {
        teacherId,
        ...dto,
      } as unknown as Prisma.TeacherAssignmentUncheckedCreateInput,
    });
    return toAssignmentResponse(assignment);
  }

  async unassign(teacherId: string, assignmentId: string): Promise<void> {
    const assignment = await this.prisma.teacherAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.teacherId !== teacherId) {
      throw new NotFoundException(
        `Assignment ${assignmentId} not found for teacher ${teacherId}`,
      );
    }
    await this.prisma.teacherAssignment.delete({ where: { id: assignmentId } });
  }

  private async assertSubjectsExist(subjectIds: string[]): Promise<void> {
    if (subjectIds.length === 0) return;
    const found = await this.prisma.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true },
    });
    const missing = subjectIds.filter((id) => !found.some((s) => s.id === id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Subject(s) not found: ${missing.join(', ')}`,
      );
    }
  }

  private async assertAssignmentTargetValid(dto: AssignmentDto): Promise<void> {
    const [subject, schoolClass, section] = await Promise.all([
      this.prisma.subject.findUnique({ where: { id: dto.subjectId } }),
      this.prisma.schoolClass.findUnique({ where: { id: dto.classId } }),
      this.prisma.section.findUnique({ where: { id: dto.sectionId } }),
    ]);
    if (!subject) {
      throw new BadRequestException(`Subject ${dto.subjectId} not found`);
    }
    if (!schoolClass) {
      throw new BadRequestException(`Class ${dto.classId} not found`);
    }
    if (!section || section.classId !== dto.classId) {
      throw new BadRequestException(
        `Section ${dto.sectionId} not found in class ${dto.classId}`,
      );
    }
  }

  private async wrapUniqueViolation<T>(
    employeeId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Employee ID "${employeeId}" is already in use`,
        );
      }
      throw error;
    }
  }

  private async findOrThrow(id: string): Promise<Teacher> {
    const teacher = await this.prisma.teacher.findUnique({ where: { id } });
    if (!teacher) {
      throw new NotFoundException(`Teacher ${id} not found`);
    }
    return teacher;
  }

  private async toResponse(teacher: Teacher): Promise<TeacherResponseDto> {
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { teacherId: teacher.id },
      select: { classId: true },
    });
    return {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      phone: teacher.phone,
      employeeId: teacher.employeeId,
      experienceYears: teacher.experienceYears ?? undefined,
      qualifications: (teacher.qualifications ??
        []) as unknown as TeacherResponseDto['qualifications'],
      subjectIds: teacher.subjectIds,
      classIds: [...new Set(assignments.map((a) => a.classId))],
    };
  }

  /**
   * `GET /teachers/me/dashboard` — resolved entirely from the calling user's own `Teacher.userId`
   * link (`resolveTeacherId`'s "me" idiom), never a client-supplied teacher id. Reads
   * Timetable/Attendance/Homework/Examinations data directly (same cross-module raw-Prisma-read
   * pattern `ReportsService` uses) rather than calling into those modules' services, since this
   * is a read-only aggregation with no side effects to keep encapsulated.
   */
  async getMyDashboard(userId: string): Promise<TeacherDashboardDto> {
    const teacherId = await resolveTeacherId(this.prisma, 'me', userId);
    const today = parseDateOnly(formatDateOnly(new Date()));
    // TimetableEntry.dayOfWeek: 0 = Monday..5 = Saturday (see that field's own doc comment).
    // A Sunday `getDay()` (0) has no matching slot, which is correct — no school day to show.
    const jsDay = today.getUTCDay();
    const dayOfWeek = jsDay === 0 ? -1 : jsDay - 1;

    const [entries, homework, assignments] = await Promise.all([
      this.prisma.timetableEntry.findMany({
        where: { teacherId, dayOfWeek },
        orderBy: { periodIndex: 'asc' },
      }),
      this.prisma.homework.findMany({
        where: { teacherId, deadline: { gte: today } },
        orderBy: { deadline: 'asc' },
        take: 5,
      }),
      this.prisma.teacherAssignment.findMany({ where: { teacherId } }),
    ]);

    const classIds = [...new Set(entries.map((e) => e.classId))];
    const sectionIds = [...new Set(entries.map((e) => e.sectionId))];
    const subjectIds = [...new Set(entries.map((e) => e.subjectId))];
    const [classes, sections, subjects] = await Promise.all([
      this.prisma.schoolClass.findMany({ where: { id: { in: classIds } } }),
      this.prisma.section.findMany({ where: { id: { in: sectionIds } } }),
      this.prisma.subject.findMany({ where: { id: { in: subjectIds } } }),
    ]);
    const classNames = new Map(classes.map((c) => [c.id, c.name]));
    const sectionNames = new Map(sections.map((s) => [s.id, s.name]));
    const subjectNames = new Map(subjects.map((s) => [s.id, s.name]));

    const todayClasses: TeacherDashboardDto['todayClasses'] = entries.map(
      (entry) => ({
        id: entry.id,
        subjectName: subjectNames.get(entry.subjectId) ?? 'Unknown subject',
        className: classNames.get(entry.classId) ?? 'Unknown class',
        sectionName: sectionNames.get(entry.sectionId) ?? 'Unknown section',
        startTime: entry.startTime,
      }),
    );

    // One attendance task per distinct class/section taught today that has no attendance record
    // yet for today — not per period, since attendance is marked once per class/section per day.
    const todaySections = [
      ...new Map(
        entries.map((e) => [`${e.classId}:${e.sectionId}`, e]),
      ).values(),
    ];
    const sectionsNeedingAttendance = await Promise.all(
      todaySections.map(async (e) => {
        const marked = await this.prisma.attendanceRecord.count({
          where: { classId: e.classId, sectionId: e.sectionId, date: today },
        });
        return marked === 0 ? e : null;
      }),
    );
    const attendanceTasks: TeacherDashboardDto['attendanceTasks'] =
      sectionsNeedingAttendance
        .filter((e) => e !== null)
        .map((e) => ({
          id: `${e.classId}:${e.sectionId}`,
          label: `Mark attendance — ${classNames.get(e.classId) ?? 'Unknown class'} / ${sectionNames.get(e.sectionId) ?? 'Unknown section'}`,
          dueLabel: 'Today',
        }));

    const pendingAssignments: TeacherDashboardDto['pendingAssignments'] =
      homework.map((hw) => ({
        id: hw.id,
        label: hw.title,
        dueLabel: formatDateOnly(hw.deadline),
      }));

    const examWhere: Prisma.ExamWhereInput = {
      date: { gte: today },
      OR: assignments.map((a) => ({
        subjectId: a.subjectId,
        classId: a.classId,
        sectionId: a.sectionId,
      })),
    };
    const exams =
      assignments.length > 0
        ? await this.prisma.exam.findMany({
            where: examWhere,
            orderBy: { date: 'asc' },
            take: 5,
          })
        : [];
    const examClassIds = [...new Set(exams.map((e) => e.classId))];
    const examSectionIds = [...new Set(exams.map((e) => e.sectionId))];
    const [examClasses, examSections] = await Promise.all([
      this.prisma.schoolClass.findMany({
        where: { id: { in: examClassIds.filter((id) => !classNames.has(id)) } },
      }),
      this.prisma.section.findMany({
        where: {
          id: { in: examSectionIds.filter((id) => !sectionNames.has(id)) },
        },
      }),
    ]);
    for (const c of examClasses) classNames.set(c.id, c.name);
    for (const s of examSections) sectionNames.set(s.id, s.name);

    const upcomingExams: TeacherDashboardDto['upcomingExams'] = exams.map(
      (exam) => ({
        id: exam.id,
        label: `${classNames.get(exam.classId) ?? 'Unknown class'} / ${sectionNames.get(exam.sectionId) ?? 'Unknown section'} exam`,
        dueLabel: formatDateOnly(exam.date),
      }),
    );

    return { todayClasses, attendanceTasks, pendingAssignments, upcomingExams };
  }
}

function toTeacherData(dto: TeacherDto) {
  return {
    name: dto.name,
    email: dto.email,
    phone: dto.phone,
    employeeId: dto.employeeId,
    experienceYears: dto.experienceYears ?? null,
    qualifications: dto.qualifications.map((q) => ({
      degree: q.degree,
      institution: q.institution,
      year: q.year,
    })) as Prisma.InputJsonValue,
    subjectIds: dto.subjectIds,
  };
}

function toAssignmentResponse(
  assignment: TeacherAssignment,
): AssignmentResponseDto {
  return {
    id: assignment.id,
    teacherId: assignment.teacherId,
    subjectId: assignment.subjectId,
    classId: assignment.classId,
    sectionId: assignment.sectionId,
  };
}
