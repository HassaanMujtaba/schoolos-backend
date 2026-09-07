import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceRecord, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { resolveStudentId } from '../common/identity/resolve-me';
import { BulkAttendanceDto } from './dto/bulk-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import {
  AttendanceAnalyticsQueryDto,
  AttendanceGroupBy,
  AttendanceScope,
} from './dto/attendance-analytics-query.dto';
import {
  AttendanceAnalyticsResponseDto,
  AttendanceAnalyticsRowDto,
  AttendanceRecordResponseDto,
} from './dto/attendance-response.dto';

/** `frontend/src/features/attendance/api.ts`'s surface (student attendance half) — §13. */
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getFiltered(
    query: ListAttendanceQueryDto,
    currentUserId: string | null,
  ): Promise<AttendanceRecordResponseDto[]> {
    if (query.studentId) {
      const studentId = await resolveStudentId(
        this.prisma,
        query.studentId,
        currentUserId,
      );
      const where: Prisma.AttendanceRecordWhereInput = {
        studentId,
        ...(query.from || query.to
          ? {
              date: {
                ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
                ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
              },
            }
          : {}),
      };
      const records = await this.prisma.attendanceRecord.findMany({
        where,
        orderBy: { date: 'desc' },
      });
      return this.toResponses(records);
    }

    if (!query.classId || !query.sectionId || !query.date) {
      throw new BadRequestException(
        'classId, sectionId and date are required unless studentId is provided',
      );
    }
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        classId: query.classId,
        sectionId: query.sectionId,
        date: parseDateOnly(query.date),
      },
      orderBy: { studentId: 'asc' },
    });
    return this.toResponses(records);
  }

  /**
   * `POST /attendance/bulk` — one call submits a full class's marks (`attendance.md`'s "optimize
   * for speed" requirement, not N individual requests). Upserts on `[studentId, date]`: marking an
   * already-marked day again corrects it in place, matching `attendance.md`'s "pre-fills the
   * marking UI if already partially marked".
   */
  async bulkSubmit(
    dto: BulkAttendanceDto,
    user: AuthenticatedUser,
  ): Promise<AttendanceRecordResponseDto[]> {
    await this.assertSectionInClass(dto.classId, dto.sectionId);
    await this.assertStudentsExist(dto.records.map((r) => r.studentId));

    const date = parseDateOnly(dto.date);
    const now = new Date();

    const records = await this.prisma.$transaction(async (tx) => {
      const results: AttendanceRecord[] = [];
      for (const record of dto.records) {
        const saved = await tx.attendanceRecord.upsert({
          where: { studentId_date: { studentId: record.studentId, date } },
          create: {
            studentId: record.studentId,
            classId: dto.classId,
            sectionId: dto.sectionId,
            date,
            status: record.status,
            markedByUserId: user.id,
            markedByLabel: user.name,
            markedAt: now,
          } as unknown as Prisma.AttendanceRecordUncheckedCreateInput,
          update: {
            classId: dto.classId,
            sectionId: dto.sectionId,
            status: record.status,
            markedByUserId: user.id,
            markedByLabel: user.name,
            markedAt: now,
          },
        });
        results.push(saved);
      }
      return results;
    });

    return this.toResponses(records);
  }

  /** `attendance.modify` — correcting a single already-submitted record. */
  async updateRecord(
    id: string,
    dto: UpdateAttendanceDto,
    user: AuthenticatedUser,
  ): Promise<AttendanceRecordResponseDto> {
    await this.findRecordOrThrow(id);
    const record = await this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        status: dto.status,
        markedByUserId: user.id,
        markedByLabel: user.name,
        markedAt: new Date(),
      },
    });
    return (await this.toResponses([record]))[0];
  }

  /**
   * §13 Attendance Analytics. `groupBy: 'teacher'` groups by the *marking* teacher
   * (`AttendanceRecord.markedByUserId`) — there's no other teacher link on an attendance record,
   * and this is a defensible real reading of "teacher" analytics (whose marked attendance shows
   * what rate), not an invented one. `groupBy: 'branch'` is a real, flagged gap: no
   * `Student`/`SchoolClass`/`Section` in this schema carries a `branchId` today (branches exist
   * only at the school-setup level, PRD §6, never linked to academic structure) — every record
   * buckets into one tenant-wide row rather than fabricating a multi-branch split that isn't there.
   */
  async getAnalytics(
    query: AttendanceAnalyticsQueryDto,
  ): Promise<AttendanceAnalyticsResponseDto> {
    const today = truncateToDate(new Date());
    const { from, to } = await this.resolveDateRange(query.scope, today);

    const [todayRecords, rangeRecords] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { date: today } }),
      this.prisma.attendanceRecord.findMany({
        where: { date: { gte: from, lte: to } },
      }),
    ]);

    const todayPresentRate = rate(
      todayRecords.filter((r) => r.status === 'present').length,
      todayRecords.length,
    );
    const rows = await this.buildRows(query.groupBy, rangeRecords);

    return { todayPresentRate, rows };
  }

  /** `attendance.export` — same params as analytics, CSV instead of JSON. */
  async exportCsv(query: AttendanceAnalyticsQueryDto): Promise<string> {
    const analytics = await this.getAnalytics(query);
    const header = ['Label', 'Present', 'Absent', 'Total', 'Attendance Rate'];
    const rows = analytics.rows.map((r) =>
      [
        r.label,
        r.presentCount,
        r.absentCount,
        r.totalCount,
        `${Math.round(r.attendanceRate * 100)}%`,
      ]
        .map((v) => csvEscape(String(v)))
        .join(','),
    );
    return [header.map(csvEscape).join(','), ...rows].join('\n');
  }

  private async resolveDateRange(
    scope: AttendanceScope,
    today: Date,
  ): Promise<{ from: Date; to: Date }> {
    switch (scope) {
      case 'daily':
        return { from: today, to: today };
      case 'weekly': {
        const from = new Date(today);
        from.setUTCDate(from.getUTCDate() - 6);
        return { from, to: today };
      }
      case 'monthly': {
        const from = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
        );
        return { from, to: today };
      }
      case 'term': {
        const term = await this.prisma.term.findFirst({
          where: { startDate: { lte: today }, endDate: { gte: today } },
        });
        if (term) return { from: term.startDate, to: term.endDate };
        // No active term configured — fall back to a trailing 90-day window rather than erroring
        // the whole dashboard out.
        const from = new Date(today);
        from.setUTCDate(from.getUTCDate() - 90);
        return { from, to: today };
      }
    }
  }

  private async buildRows(
    groupBy: AttendanceGroupBy,
    records: AttendanceRecord[],
  ): Promise<AttendanceAnalyticsRowDto[]> {
    if (groupBy === 'branch') {
      return [toRow('all', 'All branches', records)];
    }

    const keyOf = (r: AttendanceRecord): string =>
      groupBy === 'student'
        ? r.studentId
        : groupBy === 'class'
          ? r.classId
          : (r.markedByUserId ?? 'unknown');

    const groups = new Map<string, AttendanceRecord[]>();
    for (const record of records) {
      const key = keyOf(record);
      const bucket = groups.get(key);
      if (bucket) bucket.push(record);
      else groups.set(key, [record]);
    }

    const labels = await this.resolveLabels(
      groupBy,
      [...groups.keys()],
      records,
    );
    return [...groups.entries()].map(([id, recs]) =>
      toRow(id, labels.get(id) ?? id, recs),
    );
  }

  private async resolveLabels(
    groupBy: AttendanceGroupBy,
    ids: string[],
    records: AttendanceRecord[],
  ): Promise<Map<string, string>> {
    if (groupBy === 'student') {
      const students = await this.prisma.student.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      return new Map(students.map((s) => [s.id, s.name]));
    }
    if (groupBy === 'class') {
      const classes = await this.prisma.schoolClass.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      return new Map(classes.map((c) => [c.id, c.name]));
    }
    // 'teacher' — the marking teacher's label is already denormalized onto each record
    // (`markedByLabel`), no join needed.
    const labels = new Map<string, string>();
    for (const record of records) {
      if (record.markedByUserId && !labels.has(record.markedByUserId)) {
        labels.set(
          record.markedByUserId,
          record.markedByLabel || record.markedByUserId,
        );
      }
    }
    return labels;
  }

  private async assertSectionInClass(
    classId: string,
    sectionId: string,
  ): Promise<void> {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.classId !== classId) {
      throw new BadRequestException(
        `Section ${sectionId} not found in class ${classId}`,
      );
    }
  }

  private async assertStudentsExist(studentIds: string[]): Promise<void> {
    const found = await this.prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true },
    });
    const missing = studentIds.filter((id) => !found.some((s) => s.id === id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Student(s) not found: ${missing.join(', ')}`,
      );
    }
  }

  private async findRecordOrThrow(id: string): Promise<AttendanceRecord> {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException(`Attendance record ${id} not found`);
    }
    return record;
  }

  private async toResponses(
    records: AttendanceRecord[],
  ): Promise<AttendanceRecordResponseDto[]> {
    const studentIds = [...new Set(records.map((r) => r.studentId))];
    const students = studentIds.length
      ? await this.prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(students.map((s) => [s.id, s.name]));

    return records.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: nameById.get(r.studentId) ?? '',
      classId: r.classId,
      sectionId: r.sectionId,
      date: formatDateOnly(r.date),
      status: r.status,
      markedBy: r.markedByLabel,
      markedAt: r.markedAt.toISOString(),
    }));
  }
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function toRow(
  id: string,
  label: string,
  records: { status: string }[],
): AttendanceAnalyticsRowDto {
  const presentCount = records.filter((r) => r.status === 'present').length;
  const absentCount = records.filter((r) => r.status === 'absent').length;
  const totalCount = records.length;
  return {
    id,
    label,
    presentCount,
    absentCount,
    totalCount,
    attendanceRate: rate(presentCount, totalCount),
  };
}

function truncateToDate(date: Date): Date {
  return parseDateOnly(formatDateOnly(date));
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
