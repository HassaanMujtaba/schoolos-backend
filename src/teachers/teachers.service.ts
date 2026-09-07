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
import { TeacherDto } from './dto/teacher.dto';
import { AssignmentDto } from './dto/assignment.dto';
import {
  AssignmentResponseDto,
  TeacherResponseDto,
} from './dto/teacher-response.dto';

const SORTABLE_FIELDS = ['name', 'employeeId', 'createdAt'] as const;

/** `frontend/src/features/teachers/api.ts`'s surface — §10, admin CRUD + subject/class/section
 * assignment. The teacher dashboard (`GET /teachers/me/dashboard`) is Phase 4's, not this
 * module's — it aggregates timetable/attendance/homework/examinations data that doesn't exist
 * yet. */
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
