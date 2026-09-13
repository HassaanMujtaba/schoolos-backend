import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for `GET /reports/*` — field-for-field against
 * `frontend/src/features/reports/api.ts`'s own interfaces (`PrincipalDashboardSummary`,
 * `AcademicReport`, `FinancialReport` and their row types). See `../reports.service.ts`'s header
 * comment for what each number actually measures — this file is shapes only.
 */

export class PrincipalDashboardResponseDto {
  @ApiProperty()
  totalStudents!: number;

  @ApiProperty()
  totalTeachers!: number;

  @ApiProperty()
  attendanceRatePct!: number;

  @ApiProperty()
  feesCollected!: number;

  @ApiProperty()
  outstandingFees!: number;

  @ApiProperty()
  admissionsThisTerm!: number;

  @ApiProperty()
  academicPerformancePct!: number;
}

export class ClassPerformanceRowDto {
  @ApiProperty()
  classId!: string;

  @ApiProperty()
  className!: string;

  @ApiProperty()
  averageScorePct!: number;

  @ApiProperty()
  passRatePct!: number;
}

export class SubjectPerformanceRowDto {
  @ApiProperty()
  subjectId!: string;

  @ApiProperty()
  subjectName!: string;

  @ApiProperty()
  averageScorePct!: number;

  @ApiProperty()
  passRatePct!: number;
}

export class GradeDistributionRowDto {
  @ApiProperty()
  grade!: string;

  @ApiProperty()
  count!: number;
}

export class AttendanceTrendPointDto {
  @ApiProperty({
    description:
      'Pre-labeled period, e.g. "Sep 1" — the server picks the grain.',
  })
  period!: string;

  @ApiProperty()
  attendanceRatePct!: number;
}

export class TeacherPerformanceRowDto {
  @ApiProperty()
  teacherId!: string;

  @ApiProperty()
  teacherName!: string;

  @ApiProperty()
  averageScorePct!: number;
}

export class AcademicReportResponseDto {
  @ApiProperty()
  overallPassRatePct!: number;

  @ApiProperty({ type: [ClassPerformanceRowDto] })
  classPerformance!: ClassPerformanceRowDto[];

  @ApiProperty({ type: [SubjectPerformanceRowDto] })
  subjectPerformance!: SubjectPerformanceRowDto[];

  @ApiProperty({ type: [GradeDistributionRowDto] })
  gradeDistribution!: GradeDistributionRowDto[];

  @ApiProperty({ type: [AttendanceTrendPointDto] })
  attendanceTrend!: AttendanceTrendPointDto[];

  @ApiProperty({ type: [TeacherPerformanceRowDto] })
  teacherPerformance!: TeacherPerformanceRowDto[];
}

export class RevenueTrendPointDto {
  @ApiProperty({ description: 'Pre-labeled period, e.g. "Mar 2026".' })
  period!: string;

  @ApiProperty()
  revenue!: number;

  @ApiProperty()
  expenses!: number;
}

export class FinancialReportResponseDto {
  @ApiProperty()
  totalRevenue!: number;

  @ApiProperty()
  totalExpenses!: number;

  @ApiProperty()
  collectionRatePct!: number;

  @ApiProperty()
  outstandingTotal!: number;

  @ApiProperty({ type: [RevenueTrendPointDto] })
  trend!: RevenueTrendPointDto[];
}
