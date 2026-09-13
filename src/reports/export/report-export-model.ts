import {
  AcademicReportResponseDto,
  FinancialReportResponseDto,
  PrincipalDashboardResponseDto,
} from '../dto/report-response.dto';

/**
 * The one shape every export renderer (`../pdf/report-pdf.ts`, `../excel/report-excel.ts`,
 * `./report-csv.ts`) consumes — `frontend/modules/reports-analytics.md`'s "PDF/Excel export is
 * entirely server-generated ... budget real time for report-template/export-formatting work
 * here" turned into one intermediate representation instead of three renderers each re-deriving
 * their own layout from the raw report DTOs. Pure data-shaping, no Prisma/Nest DI — same
 * "business logic that happens to render, not fetch" split `examinations/grading-scale.ts` and
 * `certificates/pdf/certificate-pdf.ts` already use, so the three build* functions below are
 * unit-testable without a database.
 */
export interface ReportExportTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface ReportExportModel {
  title: string;
  /** e.g. "For the current term" / "Jan 1 – Jun 30, 2026" — display-only, no parsed meaning. */
  subtitle: string;
  summary: Array<{ label: string; value: string }>;
  tables: ReportExportTable[];
}

/**
 * CSV/Excel formula-injection guard (OWASP "CSV Injection") — `className`/`subjectName`/
 * `teacherName` below all echo free-text entered through other modules' own CRUD forms
 * (`school-setup`/`teachers`), so a value starting with `=`/`+`/`-`/`@` reaching a spreadsheet
 * cell unescaped would execute as a formula the moment a principal opens the exported file. Used
 * by `../excel/report-excel.ts` and `./report-csv.ts` (the two renderers that actually open in a
 * spreadsheet app) — `../pdf/report-pdf.ts` draws plain text, nothing to neutralize there.
 */
export function sanitizeSpreadsheetCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function pctLabel(value: number): string {
  return `${value.toFixed(1)}%`;
}

function moneyLabel(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildPrincipalDashboardExportModel(
  data: PrincipalDashboardResponseDto,
): ReportExportModel {
  return {
    title: 'Principal Dashboard',
    subtitle: 'Headline metrics as of now',
    summary: [
      { label: 'Total students', value: String(data.totalStudents) },
      { label: 'Total teachers', value: String(data.totalTeachers) },
      { label: 'Attendance rate', value: pctLabel(data.attendanceRatePct) },
      { label: 'Fees collected', value: moneyLabel(data.feesCollected) },
      { label: 'Outstanding fees', value: moneyLabel(data.outstandingFees) },
      { label: 'Admissions this term', value: String(data.admissionsThisTerm) },
      {
        label: 'Academic performance',
        value: pctLabel(data.academicPerformancePct),
      },
    ],
    tables: [],
  };
}

export function buildAcademicReportExportModel(
  data: AcademicReportResponseDto,
): ReportExportModel {
  return {
    title: 'Academic Report',
    subtitle: `Overall pass rate ${pctLabel(data.overallPassRatePct)}`,
    summary: [
      { label: 'Overall pass rate', value: pctLabel(data.overallPassRatePct) },
    ],
    tables: [
      {
        title: 'Class performance',
        columns: ['Class', 'Average score', 'Pass rate'],
        rows: data.classPerformance.map((row) => [
          row.className,
          pctLabel(row.averageScorePct),
          pctLabel(row.passRatePct),
        ]),
      },
      {
        title: 'Subject performance',
        columns: ['Subject', 'Average score', 'Pass rate'],
        rows: data.subjectPerformance.map((row) => [
          row.subjectName,
          pctLabel(row.averageScorePct),
          pctLabel(row.passRatePct),
        ]),
      },
      {
        title: 'Teacher performance',
        columns: ['Teacher', 'Average score'],
        rows: data.teacherPerformance.map((row) => [
          row.teacherName,
          pctLabel(row.averageScorePct),
        ]),
      },
      {
        title: 'Grade distribution',
        columns: ['Grade', 'Count'],
        rows: data.gradeDistribution.map((row) => [row.grade, row.count]),
      },
      {
        title: 'Attendance trend',
        columns: ['Period', 'Attendance rate'],
        rows: data.attendanceTrend.map((row) => [
          row.period,
          pctLabel(row.attendanceRatePct),
        ]),
      },
    ],
  };
}

export function buildFinancialReportExportModel(
  data: FinancialReportResponseDto,
  from: string,
  to: string,
): ReportExportModel {
  return {
    title: 'Financial Report',
    subtitle: `${from} – ${to}`,
    summary: [
      { label: 'Total revenue', value: moneyLabel(data.totalRevenue) },
      { label: 'Total expenses', value: moneyLabel(data.totalExpenses) },
      { label: 'Collection rate', value: pctLabel(data.collectionRatePct) },
      { label: 'Outstanding', value: moneyLabel(data.outstandingTotal) },
    ],
    tables: [
      {
        title: 'Monthly trend',
        columns: ['Period', 'Revenue', 'Expenses'],
        rows: data.trend.map((row) => [
          row.period,
          moneyLabel(row.revenue),
          moneyLabel(row.expenses),
        ]),
      },
    ],
  };
}
