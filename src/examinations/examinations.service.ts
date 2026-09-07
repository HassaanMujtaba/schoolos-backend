import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Exam, ExamMark, Prisma, Student } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { resolveStudentId } from '../common/identity/resolve-me';
import { ExamDto } from './dto/exam.dto';
import { ListExamsQueryDto } from './dto/list-exams-query.dto';
import { BulkMarksDto } from './dto/bulk-marks.dto';
import {
  ExamResponseDto,
  ExamResultRowDto,
  ExamResultsResponseDto,
  MarksEntryRowDto,
  MarksEntrySheetResponseDto,
  ReportCardResponseDto,
  ReportCardSubjectRowDto,
} from './dto/exam-response.dto';
import {
  computeRanks,
  EXAM_TYPE_LABELS,
  gradeForPercentage,
} from './grading-scale';

/**
 * `frontend/src/features/examinations/api.ts`'s surface — §16. See this module's
 * `../../../implementation-plan.md` "Phase 5" section for the two schema corrections
 * (no separate Mark/Result/Grade/ReportCard entities; report cards group sibling `Exam` rows by
 * `(type, classId, sectionId)`) and the marks-lock override decision.
 */
@Injectable()
export class ExaminationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListExamsQueryDto,
    currentUserId: string | null,
  ): Promise<PagedResult<ExamResponseDto>> {
    let scopedStudent: Student | null = null;
    if (query.studentId) {
      const studentId = await resolveStudentId(
        this.prisma,
        query.studentId,
        currentUserId,
      );
      scopedStudent = await this.findStudentOrThrow(studentId);
    }

    const where: Prisma.ExamWhereInput = {
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(scopedStudent
        ? { classId: scopedStudent.classId, sectionId: scopedStudent.sectionId }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.exam.findMany({
          where,
          orderBy: { date: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.exam.count({ where }),
    );
    return { items: result.items.map(toExamResponse), total: result.total };
  }

  async get(id: string): Promise<ExamResponseDto> {
    return toExamResponse(await this.findExamOrThrow(id));
  }

  async create(dto: ExamDto): Promise<ExamResponseDto> {
    await this.assertExamTargetValid(dto);
    const exam = await this.prisma.exam.create({
      data: toExamData(dto) as unknown as Prisma.ExamUncheckedCreateInput,
    });
    return toExamResponse(exam);
  }

  async update(
    id: string,
    dto: ExamDto,
    user: AuthenticatedUser,
  ): Promise<ExamResponseDto> {
    const existing = await this.findExamOrThrow(id);
    this.assertNotLocked(existing, user);
    await this.assertExamTargetValid(dto);
    const exam = await this.prisma.exam.update({
      where: { id },
      data: toExamData(dto),
    });
    return toExamResponse(exam);
  }

  /** `GET /exams/:id/marks-entry-sheet` — one row per student enrolled in the exam's class/section,
   * pre-filled from any `ExamMark` already entered. */
  async getMarksEntrySheet(
    examId: string,
  ): Promise<MarksEntrySheetResponseDto> {
    const exam = await this.findExamOrThrow(examId);
    const [roster, marks] = await Promise.all([
      this.rosterFor(exam),
      this.prisma.examMark.findMany({ where: { examId } }),
    ]);
    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));

    return {
      examId: exam.id,
      maxMarks: exam.maxMarks,
      isLocked: exam.isPublished,
      rows: roster.map((student) => {
        const mark = markByStudent.get(student.id);
        return {
          studentId: student.id,
          studentName: student.name,
          admissionNumber: student.admissionNumber,
          marksObtained: mark?.marksObtained ?? null,
          isAbsent: mark?.isAbsent ?? false,
        };
      }),
    };
  }

  /** `POST /exams/:id/marks` — bulk upsert on `[examId, studentId]`, not one request per student. */
  async submitBulkMarks(
    examId: string,
    dto: BulkMarksDto,
    user: AuthenticatedUser,
  ): Promise<MarksEntryRowDto[]> {
    if (dto.examId !== examId) {
      throw new BadRequestException('examId in body does not match the route');
    }
    const exam = await this.findExamOrThrow(examId);
    this.assertNotLocked(exam, user);

    const invalid = dto.records.filter(
      (r) => !r.isAbsent && r.marksObtained === null,
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Enter marks or mark absent for: ${invalid.map((r) => r.studentId).join(', ')}`,
      );
    }
    const overMax = dto.records.filter(
      (r) => r.marksObtained !== null && r.marksObtained > exam.maxMarks,
    );
    if (overMax.length > 0) {
      throw new BadRequestException(
        `Marks exceed max marks (${exam.maxMarks}) for: ${overMax.map((r) => r.studentId).join(', ')}`,
      );
    }
    await this.assertStudentsInRoster(
      exam,
      dto.records.map((r) => r.studentId),
    );

    const saved = await this.prisma.$transaction(async (tx) => {
      const results: ExamMark[] = [];
      for (const record of dto.records) {
        const mark = await tx.examMark.upsert({
          where: {
            examId_studentId: { examId, studentId: record.studentId },
          },
          create: {
            examId,
            studentId: record.studentId,
            marksObtained: record.marksObtained,
            isAbsent: record.isAbsent,
          } as unknown as Prisma.ExamMarkUncheckedCreateInput,
          update: {
            marksObtained: record.marksObtained,
            isAbsent: record.isAbsent,
          },
        });
        results.push(mark);
      }
      return results;
    });

    const students = await this.prisma.student.findMany({
      where: { id: { in: saved.map((m) => m.studentId) } },
      select: { id: true, name: true, admissionNumber: true },
    });
    const studentById = new Map(students.map((s) => [s.id, s]));
    return saved.map((m) => ({
      studentId: m.studentId,
      studentName: studentById.get(m.studentId)?.name ?? '',
      admissionNumber: studentById.get(m.studentId)?.admissionNumber ?? '',
      marksObtained: m.marksObtained,
      isAbsent: m.isAbsent,
    }));
  }

  /** `GET /exams/:id/results` — grade/GPA/rank, computed here, never recomputed client-side. */
  async getResults(examId: string): Promise<ExamResultsResponseDto> {
    const exam = await this.findExamOrThrow(examId);
    const rows = await this.buildResultRows(exam);
    return { examId: exam.id, isPublished: exam.isPublished, rows };
  }

  /** `POST /exams/:id/publish` — `results.publish`. Locks further marks edits (see
   * `Exam.isPublished`'s schema doc comment for the "re-opened by an authorized role" override). */
  async publish(examId: string): Promise<ExamResultsResponseDto> {
    await this.findExamOrThrow(examId);
    const updated = await this.prisma.exam.update({
      where: { id: examId },
      data: { isPublished: true },
    });
    const rows = await this.buildResultRows(updated);
    return { examId: updated.id, isPublished: updated.isPublished, rows };
  }

  /**
   * `GET /report-cards/:studentId?examId=` — shared by the back office and the Parent/Student
   * portal (`PortalResultsPage`'s own comment: "whether an exam's results are actually published
   * yet is left to the report-card endpoint itself to enforce"). No `@RequirePermission` on this
   * route (see `ReportCardsController`) — a caller with `results.read` gets any student's card
   * regardless of publish state (the staff preview case, matching `results.read`'s existing
   * back-office "Results" gate); everyone else must own the record (the student themselves, or a
   * linked parent — same `assertCanActForStudent` pattern `LeaveService` already uses) *and* the
   * anchor exam must be published.
   */
  async getReportCard(
    rawStudentId: string,
    examId: string,
    user: AuthenticatedUser,
  ): Promise<ReportCardResponseDto> {
    const anchorExam = await this.findExamOrThrow(examId);
    const studentId = await resolveStudentId(
      this.prisma,
      rawStudentId,
      user.id,
    );
    const student = await this.findStudentOrThrow(studentId);

    const isStaff = user.permissions.includes('results.read');
    if (!isStaff) {
      await this.assertCanViewStudent(studentId, user);
      if (!anchorExam.isPublished) {
        throw new ForbiddenException('Results have not been published yet');
      }
    }

    const siblings = await this.prisma.exam.findMany({
      where: {
        type: anchorExam.type,
        classId: anchorExam.classId,
        sectionId: anchorExam.sectionId,
      },
    });
    const siblingIds = siblings.map((s) => s.id);

    const [classroom, section, subjects, classmates] = await Promise.all([
      this.prisma.schoolClass.findUnique({ where: { id: anchorExam.classId } }),
      this.prisma.section.findUnique({ where: { id: anchorExam.sectionId } }),
      this.prisma.subject.findMany({
        where: { id: { in: siblings.map((s) => s.subjectId) } },
        select: { id: true, name: true },
      }),
      this.prisma.student.findMany({
        where: { classId: anchorExam.classId, sectionId: anchorExam.sectionId },
        select: { id: true },
      }),
    ]);
    const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

    const allMarks = await this.prisma.examMark.findMany({
      where: { examId: { in: siblingIds } },
    });
    const marksByStudent = new Map<string, ExamMark[]>();
    for (const mark of allMarks) {
      const bucket = marksByStudent.get(mark.studentId);
      if (bucket) bucket.push(mark);
      else marksByStudent.set(mark.studentId, [mark]);
    }

    const totalMaxMarks = siblings.reduce((sum, s) => sum + s.maxMarks, 0);
    const totals = classmates.map((c) => ({
      id: c.id,
      value: percentageAcross(
        siblings,
        marksByStudent.get(c.id) ?? [],
        totalMaxMarks,
      ),
    }));
    const rankByStudent = computeRanks(totals);

    const marksBySibling = new Map(
      (marksByStudent.get(studentId) ?? []).map((m) => [m.examId, m]),
    );
    const subjectRows: ReportCardSubjectRowDto[] = siblings.map((sibling) => {
      const mark = marksBySibling.get(sibling.id);
      const percentage =
        mark && !mark.isAbsent && mark.marksObtained !== null
          ? (mark.marksObtained / sibling.maxMarks) * 100
          : null;
      return {
        subjectId: sibling.subjectId,
        subjectName:
          subjectNameById.get(sibling.subjectId) ?? sibling.subjectId,
        maxMarks: sibling.maxMarks,
        marksObtained: mark?.marksObtained ?? null,
        isAbsent: mark?.isAbsent ?? false,
        grade:
          percentage === null ? null : gradeForPercentage(percentage).grade,
      };
    });
    const totalMarksObtained = subjectRows.reduce(
      (sum, r) => sum + (r.isAbsent ? 0 : (r.marksObtained ?? 0)),
      0,
    );
    const percentage =
      totalMaxMarks > 0 ? (totalMarksObtained / totalMaxMarks) * 100 : 0;
    const overall = gradeForPercentage(percentage);

    return {
      studentId: student.id,
      studentName: student.name,
      admissionNumber: student.admissionNumber,
      className: classroom?.name ?? '',
      sectionName: section?.name ?? '',
      examId: anchorExam.id,
      examName: EXAM_TYPE_LABELS[anchorExam.type] ?? anchorExam.type,
      subjects: subjectRows,
      totalMarksObtained,
      totalMaxMarks,
      percentage: round2(percentage),
      grade: overall.grade,
      gpa: overall.gpa,
      rank: rankByStudent.get(studentId) ?? null,
    };
  }

  // ---------------------------------------------------------------------------

  private async buildResultRows(exam: Exam): Promise<ExamResultRowDto[]> {
    const [roster, marks] = await Promise.all([
      this.rosterFor(exam),
      this.prisma.examMark.findMany({ where: { examId: exam.id } }),
    ]);
    const markByStudent = new Map(marks.map((m) => [m.studentId, m]));

    const percentages = roster.map((student) => {
      const mark = markByStudent.get(student.id);
      const percentage =
        mark && !mark.isAbsent && mark.marksObtained !== null
          ? (mark.marksObtained / exam.maxMarks) * 100
          : null;
      return { id: student.id, value: percentage };
    });
    const rankByStudent = computeRanks(percentages);
    const percentageByStudent = new Map(
      percentages.map((p) => [p.id, p.value]),
    );

    return roster.map((student) => {
      const mark = markByStudent.get(student.id);
      const percentage = percentageByStudent.get(student.id) ?? null;
      const graded =
        percentage === null ? null : gradeForPercentage(percentage);
      return {
        studentId: student.id,
        studentName: student.name,
        admissionNumber: student.admissionNumber,
        marksObtained: mark?.marksObtained ?? null,
        isAbsent: mark?.isAbsent ?? false,
        percentage: percentage === null ? null : round2(percentage),
        grade: graded?.grade ?? null,
        gpa: graded?.gpa ?? null,
        rank: rankByStudent.get(student.id) ?? null,
      };
    });
  }

  private async rosterFor(exam: Exam): Promise<Student[]> {
    return this.prisma.student.findMany({
      where: { classId: exam.classId, sectionId: exam.sectionId },
      orderBy: { name: 'asc' },
    });
  }

  /** Marks are locked once published, unless the caller holds `results.publish` themselves — see
   * `Exam.isPublished`'s own schema doc comment for why that permission doubles as the reopen. */
  private assertNotLocked(exam: Exam, user: AuthenticatedUser): void {
    if (exam.isPublished && !user.permissions.includes('results.publish')) {
      throw new ConflictException(
        'Results have been published — marks are locked',
      );
    }
  }

  private async assertCanViewStudent(
    studentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (student?.userId === user.id) return;

    const parent = await this.prisma.parent.findUnique({
      where: { userId: user.id },
    });
    const link = parent
      ? await this.prisma.parentStudentLink.findFirst({
          where: { parentId: parent.id, studentId },
        })
      : null;
    if (!link) {
      throw new ForbiddenException('Not authorized to view this report card');
    }
  }

  private async assertExamTargetValid(dto: ExamDto): Promise<void> {
    const [schoolClass, section, subject] = await Promise.all([
      this.prisma.schoolClass.findUnique({ where: { id: dto.classId } }),
      this.prisma.section.findUnique({ where: { id: dto.sectionId } }),
      this.prisma.subject.findUnique({ where: { id: dto.subjectId } }),
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
    if (dto.invigilatorId) {
      const invigilator = await this.prisma.teacher.findUnique({
        where: { id: dto.invigilatorId },
      });
      if (!invigilator) {
        throw new BadRequestException(
          `Invigilator ${dto.invigilatorId} not found`,
        );
      }
    }
  }

  private async assertStudentsInRoster(
    exam: Exam,
    studentIds: string[],
  ): Promise<void> {
    const found = await this.prisma.student.findMany({
      where: {
        id: { in: studentIds },
        classId: exam.classId,
        sectionId: exam.sectionId,
      },
      select: { id: true },
    });
    const missing = studentIds.filter((id) => !found.some((s) => s.id === id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Student(s) not in this exam's class/section: ${missing.join(', ')}`,
      );
    }
  }

  private async findExamOrThrow(id: string): Promise<Exam> {
    const exam = await this.prisma.exam.findUnique({ where: { id } });
    if (!exam) {
      throw new NotFoundException(`Exam ${id} not found`);
    }
    return exam;
  }

  private async findStudentOrThrow(id: string): Promise<Student> {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) {
      throw new NotFoundException(`Student ${id} not found`);
    }
    return student;
  }
}

/**
 * A student who never sat any exam in the series (every sibling either has no `ExamMark` row or
 * an absent one) is unranked (`null`), same "unranked, not last place" rule `computeRanks` itself
 * documents — not scored 0%. A student who attempted at least one subject is ranked on their full
 * series total, missing/absent subjects contributing 0 toward the numerator but still counted in
 * the denominator (`totalMaxMarks`), the same way a real report card scores a skipped paper.
 */
function percentageAcross(
  exams: Pick<Exam, 'id' | 'maxMarks'>[],
  marks: ExamMark[],
  totalMaxMarks: number,
): number | null {
  if (totalMaxMarks <= 0) return null;
  const markByExam = new Map(marks.map((m) => [m.examId, m]));
  const attempted = (exam: Pick<Exam, 'id'>): ExamMark | undefined => {
    const mark = markByExam.get(exam.id);
    return mark && !mark.isAbsent && mark.marksObtained !== null
      ? mark
      : undefined;
  };
  if (!exams.some((exam) => attempted(exam))) return null;
  const obtained = exams.reduce(
    (sum, exam) => sum + (attempted(exam)?.marksObtained ?? 0),
    0,
  );
  return (obtained / totalMaxMarks) * 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toExamData(dto: ExamDto) {
  return {
    type: dto.type,
    subjectId: dto.subjectId,
    classId: dto.classId,
    sectionId: dto.sectionId,
    date: parseDateOnly(dto.date),
    startTime: dto.startTime,
    endTime: dto.endTime,
    room: dto.room,
    invigilatorId: dto.invigilatorId,
    maxMarks: dto.maxMarks,
  };
}

function toExamResponse(exam: Exam): ExamResponseDto {
  return {
    id: exam.id,
    type: exam.type,
    subjectId: exam.subjectId,
    classId: exam.classId,
    sectionId: exam.sectionId,
    date: formatDateOnly(exam.date),
    startTime: exam.startTime,
    endTime: exam.endTime,
    room: exam.room,
    invigilatorId: exam.invigilatorId,
    maxMarks: exam.maxMarks,
  };
}
