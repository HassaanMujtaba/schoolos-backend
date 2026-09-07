import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Homework, HomeworkSubmission, Prisma, Student } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { resolveStudentId } from '../common/identity/resolve-me';
import { HomeworkDto } from './dto/homework.dto';
import { SubmissionDto } from './dto/submission.dto';
import { GradingDto } from './dto/grading.dto';
import { ListHomeworkQueryDto } from './dto/list-homework-query.dto';
import {
  HomeworkResponseDto,
  SubmissionResponseDto,
} from './dto/homework-response.dto';

/** `frontend/src/features/homework/api.ts`'s surface — §15. */
@Injectable()
export class HomeworkService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListHomeworkQueryDto,
    currentUserId: string | null,
  ): Promise<PagedResult<HomeworkResponseDto>> {
    let scopedStudent: Student | null = null;
    if (query.studentId) {
      const studentId = await resolveStudentId(
        this.prisma,
        query.studentId,
        currentUserId,
      );
      scopedStudent = await this.prisma.student.findUnique({
        where: { id: studentId },
      });
      if (!scopedStudent) {
        throw new NotFoundException(`Student ${studentId} not found`);
      }
    }

    const where: Prisma.HomeworkWhereInput = {
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' } }
        : {}),
      ...(query.classId ? { classIds: { has: query.classId } } : {}),
      ...(query.teacherId ? { teacherId: query.teacherId } : {}),
      ...(scopedStudent
        ? {
            classIds: { has: scopedStudent.classId },
            OR: [
              { sectionIds: { isEmpty: true } },
              { sectionIds: { has: scopedStudent.sectionId } },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.homework.findMany({
          where,
          orderBy: { deadline: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.homework.count({ where }),
    );

    return {
      items: await Promise.all(
        result.items.map((h) => this.toResponse(h, scopedStudent)),
      ),
      total: result.total,
    };
  }

  async get(id: string): Promise<HomeworkResponseDto> {
    return this.toResponse(await this.findOrThrow(id), null);
  }

  async create(
    dto: HomeworkDto,
    user: AuthenticatedUser,
  ): Promise<HomeworkResponseDto> {
    await this.assertClassesExist(dto.classIds);
    const homework = await this.prisma.homework.create({
      data: {
        ...toHomeworkData(dto),
        teacherId: user.id,
      } as unknown as Prisma.HomeworkUncheckedCreateInput,
    });
    return this.toResponse(homework, null);
  }

  async update(id: string, dto: HomeworkDto): Promise<HomeworkResponseDto> {
    await this.findOrThrow(id);
    await this.assertClassesExist(dto.classIds);
    const homework = await this.prisma.homework.update({
      where: { id },
      data: toHomeworkData(dto),
    });
    return this.toResponse(homework, null);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.homework.delete({ where: { id } });
  }

  /**
   * Student submit — own submission only, resolved from the authenticated session
   * (`common/identity/resolve-me.ts`), never a client-supplied `studentId`
   * (`SubmissionFormValues` has no such field to begin with).
   */
  async submit(
    homeworkId: string,
    dto: SubmissionDto,
    user: AuthenticatedUser,
  ): Promise<SubmissionResponseDto> {
    await this.findOrThrow(homeworkId);
    const studentId = await resolveStudentId(this.prisma, 'me', user.id);

    const submission = await this.prisma.homeworkSubmission.upsert({
      where: { homeworkId_studentId: { homeworkId, studentId } },
      create: {
        homeworkId,
        studentId,
        textResponse: dto.textResponse,
        status: 'submitted',
      } as unknown as Prisma.HomeworkSubmissionUncheckedCreateInput,
      update: {
        textResponse: dto.textResponse,
        submittedAt: new Date(),
        status: 'submitted',
      },
    });
    return (await this.toSubmissionResponses([submission]))[0];
  }

  /** Teacher: every submission for one assignment, for the grading queue. */
  async listSubmissions(homeworkId: string): Promise<SubmissionResponseDto[]> {
    await this.findOrThrow(homeworkId);
    const submissions = await this.prisma.homeworkSubmission.findMany({
      where: { homeworkId },
      orderBy: { submittedAt: 'asc' },
    });
    return this.toSubmissionResponses(submissions);
  }

  /** Student/Parent: this student's own submission for one assignment, if any (`'me'` idiom). */
  async getMySubmission(
    homeworkId: string,
    rawStudentId: string,
    currentUserId: string | null,
  ): Promise<SubmissionResponseDto | null> {
    const studentId = await resolveStudentId(
      this.prisma,
      rawStudentId,
      currentUserId,
    );
    const submission = await this.prisma.homeworkSubmission.findUnique({
      where: { homeworkId_studentId: { homeworkId, studentId } },
    });
    if (!submission) return null;
    return (await this.toSubmissionResponses([submission]))[0];
  }

  async gradeSubmission(
    submissionId: string,
    dto: GradingDto,
    user: AuthenticatedUser,
  ): Promise<SubmissionResponseDto> {
    const existing = await this.prisma.homeworkSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!existing) {
      throw new NotFoundException(`Submission ${submissionId} not found`);
    }
    const submission = await this.prisma.homeworkSubmission.update({
      where: { id: submissionId },
      data: {
        grade: dto.grade,
        feedback: dto.feedback,
        status: 'graded',
        gradedAt: new Date(),
        gradedByUserId: user.id,
        gradedByLabel: user.name,
      },
    });
    return (await this.toSubmissionResponses([submission]))[0];
  }

  private async assertClassesExist(classIds: string[]): Promise<void> {
    const found = await this.prisma.schoolClass.findMany({
      where: { id: { in: classIds } },
      select: { id: true },
    });
    const missing = classIds.filter((id) => !found.some((c) => c.id === id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Class(es) not found: ${missing.join(', ')}`,
      );
    }
  }

  private async findOrThrow(id: string): Promise<Homework> {
    const homework = await this.prisma.homework.findUnique({ where: { id } });
    if (!homework) {
      throw new NotFoundException(`Homework ${id} not found`);
    }
    return homework;
  }

  private async toResponse(
    homework: Homework,
    scopedStudent: Student | null,
  ): Promise<HomeworkResponseDto> {
    const submissions = await this.prisma.homeworkSubmission.findMany({
      where: { homeworkId: homework.id },
    });
    const studentCount = await this.countTargetStudents(homework);

    let mySubmissionStatus:
      'not_submitted' | 'submitted' | 'graded' | undefined;
    if (scopedStudent) {
      const mine = submissions.find((s) => s.studentId === scopedStudent.id);
      mySubmissionStatus = mine ? mine.status : 'not_submitted';
    }

    return {
      id: homework.id,
      title: homework.title,
      description: homework.description,
      attachments: [],
      links: homework.links,
      deadline: homework.deadline.toISOString(),
      classIds: homework.classIds,
      sectionIds: homework.sectionIds,
      teacherId: homework.teacherId,
      createdAt: homework.createdAt.toISOString(),
      submissionCount: submissions.length,
      studentCount,
      mySubmissionStatus,
    };
  }

  /** The size of the audience this homework was assigned to — every student in `classIds` whose
   * section is either unrestricted (`sectionIds` empty) or explicitly included. */
  private async countTargetStudents(homework: Homework): Promise<number> {
    return this.prisma.student.count({
      where: {
        classId: { in: homework.classIds },
        ...(homework.sectionIds.length > 0
          ? { sectionId: { in: homework.sectionIds } }
          : {}),
      },
    });
  }

  private async toSubmissionResponses(
    submissions: HomeworkSubmission[],
  ): Promise<SubmissionResponseDto[]> {
    const studentIds = [...new Set(submissions.map((s) => s.studentId))];
    const students = studentIds.length
      ? await this.prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(students.map((s) => [s.id, s.name]));

    return submissions.map((s) => ({
      id: s.id,
      homeworkId: s.homeworkId,
      studentId: s.studentId,
      studentName: nameById.get(s.studentId) ?? '',
      files: [],
      textResponse: s.textResponse,
      submittedAt: s.submittedAt.toISOString(),
      status: s.status,
      grade: s.grade,
      feedback: s.feedback,
      gradedAt: s.gradedAt ? s.gradedAt.toISOString() : null,
      gradedBy: s.gradedByLabel,
    }));
  }
}

function toHomeworkData(dto: HomeworkDto) {
  return {
    title: dto.title,
    description: dto.description,
    links: dto.links,
    deadline: new Date(dto.deadline),
    classIds: dto.classIds,
    sectionIds: dto.sectionIds,
  };
}
