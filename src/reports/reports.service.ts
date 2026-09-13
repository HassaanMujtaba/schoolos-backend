import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { InvoicesService } from '../fees/invoices.service';
import { parseDateOnly, formatDateOnly } from '../common/dates/date-only';
import { gradeForPercentage } from '../examinations/grading-scale';
import { AcademicReportQueryDto } from './dto/academic-report-query.dto';
import { FinancialReportQueryDto } from './dto/financial-report-query.dto';
import {
  ExportReportQueryDto,
  ReportExportFormat,
  ReportKind,
} from './dto/export-report-query.dto';
import {
  AcademicReportResponseDto,
  AttendanceTrendPointDto,
  ClassPerformanceRowDto,
  FinancialReportResponseDto,
  GradeDistributionRowDto,
  PrincipalDashboardResponseDto,
  RevenueTrendPointDto,
  SubjectPerformanceRowDto,
  TeacherPerformanceRowDto,
} from './dto/report-response.dto';
import {
  buildAcademicReportExportModel,
  buildFinancialReportExportModel,
  buildPrincipalDashboardExportModel,
} from './export/report-export-model';
import { renderReportCsv } from './export/report-csv';
import { renderReportExcel } from './excel/report-excel';
import { renderReportPdf } from './pdf/report-pdf';

/**
 * `frontend/modules/reports-analytics.md`'s "Backend dependencies" — `reports/`. Every earlier
 * module already ships its own basic in-module reporting (Attendance's analytics dashboard, Fees'
 * outstanding-balances view, Admissions' funnel) per that doc's own "Summary" — this module never
 * re-derives those from scratch where a real cross-module reuse point exists (`InvoicesService.
 * getOutstanding` backs both `outstandingFees` and `outstandingTotal` below, same all-time
 * snapshot the Fees module's own dashboard already shows), and otherwise aggregates straight over
 * `AttendanceRecord`/`ExamMark`/`Payment`/`Payslip`/`AdmissionApplication` — every number here is a
 * real read of another module's own data, never a second source of truth.
 *
 * **Real design decisions this phase had to make, flagged rather than guessed silently:**
 *
 * - **"Current term" scoping.** The principal dashboard's attendance/fees-collected/admissions/
 *   academic-performance figures are all scoped to "the term running right now" (`Term.startDate
 *   <= today <= endDate`), falling back to a trailing 90-day window when no term is configured —
 *   the exact fallback `AttendanceService.resolveDateRange`'s own `'term'` scope already uses,
 *   duplicated here rather than shared (same small-per-module-helper convention every earlier
 *   phase's own `csvEscape` repeats). `outstandingFees` is the one dashboard figure that's
 *   deliberately **not** term-scoped — "outstanding" is inherently a right-now snapshot, not a
 *   trend, matching how the Fees module's own outstanding-balances view has no date filter either.
 * - **No `Expense`/accounting entity exists** (`Invoice`'s own schema.prisma header comment: "§19
 *   accounting ... not built here"). `totalExpenses` (financial report) is `Payslip.netPay` summed
 *   over **approved** payroll periods overlapping the requested range — the only real "money out"
 *   this schema tracks. A per-period draft/generated-but-unapproved payslip is deliberately
 *   excluded: an unapproved run isn't a committed expense yet.
 * - **`collectionRatePct`/`outstandingTotal` are billing-anchored, `totalRevenue` is cash-anchored**
 *   — two different questions a "financial report" legitimately asks. `totalRevenue` is real
 *   `Payment.paidAt` activity in the window (money that actually moved). `collectionRatePct`/
 *   `outstandingTotal` instead scope by `Invoice.dueDate` falling in the window ("of what was
 *   billed for this period, how much has been collected/is still owed") — the only period-
 *   anchoring field `Invoice` carries. A payment made just outside the window against an invoice
 *   due inside it (or vice versa) is real and intentional skew between the two, not a bug.
 * - **Academic report only reads `Exam.isPublished` marks** — unpublished marks aren't official
 *   results yet, same visibility rule `report-cards.controller.ts`'s own student/parent gate
 *   already enforces; a mark entered but not yet published simply doesn't move any number here.
 * - **`teacherPerformance` attribution** goes through `TeacherAssignment` (subject+class+section),
 *   the same "actual timetable assignment" entity `teachers.md`'s own data model draws the line
 *   at — a mark whose exam's (subjectId, classId, sectionId) has no matching assignment row
 *   contributes to every other table but simply has no teacher to attribute to, so it's silently
 *   excluded from this one table rather than inventing an "Unassigned" row nothing else has.
 * - **`academicPerformancePct`** (dashboard headline) is the mean score percentage across
 *   in-scope marks, not a pass rate — `overallPassRatePct` (academic report) already owns the
 *   pass-rate framing, so the dashboard's one headline number reads as "how well," not "how many
 *   passed."
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  async getPrincipalDashboard(): Promise<PrincipalDashboardResponseDto> {
    const today = truncateToDate(new Date());
    const { from, to } = await this.resolveCurrentTermRange(today);
    const toEnd = endOfDay(to);

    const [
      totalStudents,
      totalTeachers,
      attendanceRecords,
      payments,
      admissionsThisTerm,
      outstanding,
      marks,
    ] = await Promise.all([
      this.prisma.student.count({ where: { status: 'active' } }),
      this.prisma.teacher.count(),
      this.prisma.attendanceRecord.findMany({
        where: { date: { gte: from, lte: to } },
        select: { status: true },
      }),
      this.prisma.payment.findMany({
        where: { refunded: false, paidAt: { gte: from, lte: toEnd } },
        select: { amount: true },
      }),
      this.prisma.admissionApplication.count({
        where: { createdAt: { gte: from, lte: toEnd } },
      }),
      this.invoices.getOutstanding({ groupBy: 'student' }),
      this.prisma.examMark.findMany({
        where: {
          isAbsent: false,
          marksObtained: { not: null },
          exam: { isPublished: true, date: { gte: from, lte: to } },
        },
        select: { marksObtained: true, exam: { select: { maxMarks: true } } },
      }),
    ]);

    const presentCount = attendanceRecords.filter(
      (r) => r.status === 'present',
    ).length;
    const scorePercentages = marks.map(
      (m) => ((m.marksObtained as number) / m.exam.maxMarks) * 100,
    );

    return {
      totalStudents,
      totalTeachers,
      attendanceRatePct: pct(presentCount, attendanceRecords.length),
      feesCollected: round2(sum(payments.map((p) => p.amount))),
      outstandingFees: outstanding.totalOutstanding,
      admissionsThisTerm,
      academicPerformancePct: round2(avg(scorePercentages)),
    };
  }

  async getAcademicReport(
    query: AcademicReportQueryDto,
  ): Promise<AcademicReportResponseDto> {
    const marks = await this.prisma.examMark.findMany({
      where: {
        isAbsent: false,
        marksObtained: { not: null },
        exam: {
          isPublished: true,
          ...(query.classId ? { classId: query.classId } : {}),
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        },
      },
      select: {
        marksObtained: true,
        exam: {
          select: {
            classId: true,
            subjectId: true,
            sectionId: true,
            maxMarks: true,
          },
        },
      },
    });

    const scored: ScoredMark[] = marks.map((m) => ({
      percentage: ((m.marksObtained as number) / m.exam.maxMarks) * 100,
      classId: m.exam.classId,
      subjectId: m.exam.subjectId,
      sectionId: m.exam.sectionId,
    }));

    const [
      classPerformance,
      subjectPerformance,
      attendanceTrend,
      teacherPerformance,
    ] = await Promise.all([
      this.buildClassPerformance(scored),
      this.buildSubjectPerformance(scored),
      this.buildAttendanceTrend(query.classId),
      this.buildTeacherPerformance(scored),
    ]);

    return {
      overallPassRatePct: passRatePct(scored.map((s) => s.percentage)),
      classPerformance,
      subjectPerformance,
      gradeDistribution: buildGradeDistribution(
        scored.map((s) => s.percentage),
      ),
      attendanceTrend,
      teacherPerformance,
    };
  }

  async getFinancialReport(
    query: FinancialReportQueryDto,
  ): Promise<FinancialReportResponseDto> {
    const { from, to } = this.resolveFinancialRange(query);
    const toEnd = endOfDay(to);

    const [payments, invoicesInRange, payslips] = await Promise.all([
      this.prisma.payment.findMany({
        where: { refunded: false, paidAt: { gte: from, lte: toEnd } },
        select: { amount: true, paidAt: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          status: { not: 'cancelled' },
          dueDate: { gte: from, lte: to },
        },
        select: { totalAmount: true, paidAmount: true },
      }),
      this.prisma.payslip.findMany({
        where: {
          period: {
            status: 'approved',
            startDate: { lte: to },
            endDate: { gte: from },
          },
        },
        select: {
          netPay: true,
          period: { select: { startDate: true, endDate: true } },
        },
      }),
    ]);

    const billedTotal = sum(invoicesInRange.map((i) => i.totalAmount));
    const collectedOfBilled = sum(invoicesInRange.map((i) => i.paidAmount));

    return {
      totalRevenue: round2(sum(payments.map((p) => p.amount))),
      totalExpenses: round2(sum(payslips.map((p) => p.netPay))),
      collectionRatePct:
        billedTotal === 0 ? 0 : round2((collectedOfBilled / billedTotal) * 100),
      outstandingTotal: round2(
        sum(
          invoicesInRange.map((i) => Math.max(0, i.totalAmount - i.paidAmount)),
        ),
      ),
      trend: this.buildMonthlyTrend(from, to, payments, payslips),
    };
  }

  async exportReport(
    kind: ReportKind,
    format: ReportExportFormat,
    query: ExportReportQueryDto,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const school = await this.prisma.school.findFirst();
    const schoolName = school?.name ?? 'SchoolOS';
    const generatedAt = new Date();

    const model = await (async () => {
      switch (kind) {
        case 'principal-dashboard':
          return buildPrincipalDashboardExportModel(
            await this.getPrincipalDashboard(),
          );
        case 'academic':
          return buildAcademicReportExportModel(
            await this.getAcademicReport({
              classId: query.classId,
              subjectId: query.subjectId,
            }),
          );
        case 'financial': {
          const { from, to } = this.resolveFinancialRange(query);
          const report = await this.getFinancialReport({
            from: query.from,
            to: query.to,
          });
          return buildFinancialReportExportModel(
            report,
            formatDateOnly(from),
            formatDateOnly(to),
          );
        }
      }
    })();

    // eslint-disable-next-line security/detect-object-injection -- `format` is `@IsIn`-validated against REPORT_EXPORT_FORMATS by ExportReportQueryDto, never an arbitrary client key.
    const filename = `${kind}.${EXTENSION_BY_FORMAT[format]}`;
    if (format === 'csv') {
      return {
        buffer: Buffer.from(renderReportCsv(model), 'utf-8'),
        contentType: 'text/csv',
        filename,
      };
    }
    if (format === 'excel') {
      return {
        buffer: await renderReportExcel(model),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename,
      };
    }
    return {
      buffer: await renderReportPdf({ schoolName, model, generatedAt }),
      contentType: 'application/pdf',
      filename,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Same fallback `AttendanceService.resolveDateRange`'s own `'term'` scope uses — see this class's header comment. */
  private async resolveCurrentTermRange(
    today: Date,
  ): Promise<{ from: Date; to: Date }> {
    const term = await this.prisma.term.findFirst({
      where: { startDate: { lte: today }, endDate: { gte: today } },
    });
    if (term) return { from: term.startDate, to: term.endDate };
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 90);
    return { from, to: today };
  }

  /** No term concept for the financial report (module doc: "filterable by date range") — defaults to the trailing 6 months when either end is missing. */
  private resolveFinancialRange(query: { from?: string; to?: string }): {
    from: Date;
    to: Date;
  } {
    const today = truncateToDate(new Date());
    const to = query.to ? parseDateOnly(query.to) : today;
    const from = query.from
      ? parseDateOnly(query.from)
      : firstOfMonthOffset(to, -5);
    return { from, to };
  }

  private async buildClassPerformance(
    scored: ScoredMark[],
  ): Promise<ClassPerformanceRowDto[]> {
    const grouped = groupBy(scored, (s) => s.classId);
    if (grouped.size === 0) return [];
    const classes = await this.prisma.schoolClass.findMany({
      where: { id: { in: [...grouped.keys()] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(classes.map((c) => [c.id, c.name]));
    return [...grouped.entries()]
      .map(([classId, marks]) => ({
        classId,
        className: nameById.get(classId) ?? classId,
        averageScorePct: round2(avg(marks.map((m) => m.percentage))),
        passRatePct: passRatePct(marks.map((m) => m.percentage)),
      }))
      .sort((a, b) => b.averageScorePct - a.averageScorePct);
  }

  private async buildSubjectPerformance(
    scored: ScoredMark[],
  ): Promise<SubjectPerformanceRowDto[]> {
    const grouped = groupBy(scored, (s) => s.subjectId);
    if (grouped.size === 0) return [];
    const subjects = await this.prisma.subject.findMany({
      where: { id: { in: [...grouped.keys()] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(subjects.map((s) => [s.id, s.name]));
    return [...grouped.entries()]
      .map(([subjectId, marks]) => ({
        subjectId,
        subjectName: nameById.get(subjectId) ?? subjectId,
        averageScorePct: round2(avg(marks.map((m) => m.percentage))),
        passRatePct: passRatePct(marks.map((m) => m.percentage)),
      }))
      .sort((a, b) => b.averageScorePct - a.averageScorePct);
  }

  private async buildTeacherPerformance(
    scored: ScoredMark[],
  ): Promise<TeacherPerformanceRowDto[]> {
    if (scored.length === 0) return [];
    const assignments = await this.prisma.teacherAssignment.findMany({
      select: {
        teacherId: true,
        classId: true,
        subjectId: true,
        sectionId: true,
      },
    });
    const teacherIdsByKey = new Map<string, string[]>();
    for (const a of assignments) {
      const key = assignmentKey(a);
      const list = teacherIdsByKey.get(key);
      if (list) list.push(a.teacherId);
      else teacherIdsByKey.set(key, [a.teacherId]);
    }

    const percentagesByTeacher = new Map<string, number[]>();
    for (const mark of scored) {
      for (const teacherId of teacherIdsByKey.get(assignmentKey(mark)) ?? []) {
        const list = percentagesByTeacher.get(teacherId);
        if (list) list.push(mark.percentage);
        else percentagesByTeacher.set(teacherId, [mark.percentage]);
      }
    }
    if (percentagesByTeacher.size === 0) return [];

    const teachers = await this.prisma.teacher.findMany({
      where: { id: { in: [...percentagesByTeacher.keys()] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(teachers.map((t) => [t.id, t.name]));

    return [...percentagesByTeacher.entries()]
      .map(([teacherId, percentages]) => ({
        teacherId,
        teacherName: nameById.get(teacherId) ?? teacherId,
        averageScorePct: round2(avg(percentages)),
      }))
      .sort((a, b) => b.averageScorePct - a.averageScorePct);
  }

  /** Trailing 8 weeks ending today, optionally scoped to one class — `attendanceTrend`'s own grain choice, module doc's "Week 1"/"Sep" example labels either work with. */
  private async buildAttendanceTrend(
    classId?: string,
  ): Promise<AttendanceTrendPointDto[]> {
    const today = truncateToDate(new Date());
    const weeks: { from: Date; to: Date; label: string }[] = [];
    for (let i = 7; i >= 0; i--) {
      const to = new Date(today);
      to.setUTCDate(to.getUTCDate() - i * 7);
      const from = new Date(to);
      from.setUTCDate(from.getUTCDate() - 6);
      weeks.push({ from, to, label: WEEK_LABEL_FORMAT.format(from) });
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        date: { gte: weeks[0].from, lte: today },
        ...(classId ? { classId } : {}),
      },
      select: { date: true, status: true },
    });

    return weeks.map((week) => {
      const inWeek = records.filter(
        (r) => r.date >= week.from && r.date <= week.to,
      );
      const present = inWeek.filter((r) => r.status === 'present').length;
      return {
        period: week.label,
        attendanceRatePct: pct(present, inWeek.length),
      };
    });
  }

  private buildMonthlyTrend(
    from: Date,
    to: Date,
    payments: { amount: number; paidAt: Date }[],
    payslips: { netPay: number; period: { startDate: Date; endDate: Date } }[],
  ): RevenueTrendPointDto[] {
    return enumerateMonths(from, to).map((month) => ({
      period: month.label,
      revenue: round2(
        sum(
          payments
            .filter((p) => p.paidAt >= month.start && p.paidAt <= month.end)
            .map((p) => p.amount),
        ),
      ),
      expenses: round2(
        sum(
          payslips
            .filter(
              (p) =>
                p.period.startDate <= month.end &&
                p.period.endDate >= month.start,
            )
            .map((p) => p.netPay),
        ),
      ),
    }));
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — no Prisma/DI, kept local to this module (see class header comment).
// ---------------------------------------------------------------------------

interface ScoredMark {
  percentage: number;
  classId: string;
  subjectId: string;
  sectionId: string;
}

const EXTENSION_BY_FORMAT: Record<ReportExportFormat, string> = {
  pdf: 'pdf',
  excel: 'xlsx',
  csv: 'csv',
};

const WEEK_LABEL_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Grade bands (`grading-scale.ts`) — always all eight, zero-count bands included, so a chart's bar order/labels never shift between calls. */
function buildGradeDistribution(
  percentages: number[],
): GradeDistributionRowDto[] {
  const counts = new Map<string, number>();
  for (const percentage of percentages) {
    const { grade } = gradeForPercentage(percentage);
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  const order = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'];
  return order.map((grade) => ({ grade, count: counts.get(grade) ?? 0 }));
}

/** "Pass" = anything above the lowest (`F`) band — `grading-scale.ts`'s own band table, not a re-invented threshold. */
function passRatePct(percentages: number[]): number {
  if (percentages.length === 0) return 0;
  const passing = percentages.filter(
    (p) => gradeForPercentage(p).grade !== 'F',
  ).length;
  return pct(passing, percentages.length);
}

function assignmentKey(a: {
  classId: string;
  subjectId: string;
  sectionId: string;
}): string {
  return `${a.classId}|${a.subjectId}|${a.sectionId}`;
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function enumerateMonths(
  from: Date,
  to: Date,
): { start: Date; end: Date; label: string }[] {
  const months: { start: Date; end: Date; label: string }[] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  // Caps a pathological caller-supplied range (e.g. `from=2000-01-01`) at 36 buckets rather than
  // building an unbounded trend array — no product requirement asked for more.
  let guard = 0;
  while (cursor <= last && guard < 36) {
    const start = cursor;
    const end = endOfDay(
      new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)),
    );
    months.push({ start, end, label: MONTH_LABEL_FORMAT.format(start) });
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    );
    guard++;
  }
  return months;
}

function firstOfMonthOffset(date: Date, monthOffset: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1),
  );
}

function truncateToDate(date: Date): Date {
  return parseDateOnly(formatDateOnly(date));
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function pct(count: number, total: number): number {
  return total === 0 ? 0 : round2((count / total) * 100);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
