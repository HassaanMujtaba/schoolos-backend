import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Student } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { StorageService } from '../common/storage/storage.service';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { StudentDto } from './dto/student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import {
  FamilyLinkDto,
  PagedStudentsDto,
  StudentDocumentDto,
  StudentResponseDto,
  StudentSubjectDto,
} from './dto/student-response.dto';

const SORTABLE_FIELDS = ['name', 'admissionNumber', 'createdAt'] as const;

/**
 * `frontend/src/features/students/api.ts`'s surface — §8, the most-referenced entity in the
 * system. `subjects`/`classTeacherId`/`documents`/`parents`/`guardians`/`siblings` are computed at
 * read time, not stored on `Student` (`schema.prisma`'s own doc comment):
 *
 * - `subjects`: every `Subject` whose `classIds` contains this student's `classId`.
 * - `classTeacherId`: always `null` — `Section.classTeacherName` is still free text
 *   (`school-setup.md`'s own contract, unchanged by this phase; see
 *   `../../implementation-plan.md`'s Phase 3 status note), so there is no real teacher id to
 *   return. Not rendered anywhere in the built `AcademicTab` today, so this is a harmless gap, not
 *   a silent lie — revisit once class-teacher assignment gets a real FK.
 * - `documents`: `Document` rows with `category: 'student'`, `ownerId` = this student's id.
 * - `parents`/`guardians`/`siblings`: `ParentStudentLink` split by `relation`, and other students
 *   sharing at least one parent — see `toFamilyLinks`/`toSiblings` below.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly storage: StorageService,
  ) {}

  async list(query: ListStudentsQueryDto): Promise<PagedStudentsDto> {
    const where: Prisma.StudentWhereInput = {
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              {
                admissionNumber: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.student.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.student.count({ where }),
    );

    return {
      items: await Promise.all(result.items.map((s) => this.toResponse(s))),
      total: result.total,
    };
  }

  async get(id: string): Promise<StudentResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async create(dto: StudentDto): Promise<StudentResponseDto> {
    await this.assertPlacementValid(
      dto.classId,
      dto.sectionId,
      dto.academicYearId,
    );
    const tenantId = this.requireTenantId();

    const student = await this.wrapUniqueViolation(dto.admissionNumber, () =>
      this.prisma.student.create({
        // Nested `enrollments: { create: [...] }` needs `tenantId` stamped explicitly — same
        // limit as `BranchesService.create`'s own doc comment; the top-level `Student.create`
        // gets it from PrismaService's tenant-scoping extension.
        data: {
          ...toStudentData(dto),
          enrollments: {
            create: [
              {
                tenantId,
                academicYearId: dto.academicYearId,
                classId: dto.classId,
                sectionId: dto.sectionId,
              },
            ],
          },
        } as unknown as Prisma.StudentUncheckedCreateInput,
      }),
    );

    return this.toResponse(student);
  }

  async update(id: string, dto: StudentDto): Promise<StudentResponseDto> {
    const existing = await this.findOrThrow(id);
    await this.assertPlacementValid(
      dto.classId,
      dto.sectionId,
      dto.academicYearId,
    );
    const tenantId = this.requireTenantId();

    const placementChanged =
      existing.classId !== dto.classId ||
      existing.sectionId !== dto.sectionId ||
      existing.academicYearId !== dto.academicYearId;

    const student = await this.wrapUniqueViolation(dto.admissionNumber, () =>
      this.prisma.student.update({
        where: { id },
        data: {
          ...toStudentData(dto),
          // Append-only history — a new snapshot only when the placement actually changed, never
          // on every edit (`Enrollment`'s own doc comment: "every time a Student's class/section/
          // academic year changes").
          ...(placementChanged
            ? {
                enrollments: {
                  create: [
                    {
                      tenantId,
                      academicYearId: dto.academicYearId,
                      classId: dto.classId,
                      sectionId: dto.sectionId,
                    },
                  ],
                },
              }
            : {}),
        },
      }),
    );

    return this.toResponse(student);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.student.delete({ where: { id } });
  }

  /** `students.export` — CSV, per `students/api.ts`'s `exportStudents` (`responseType: 'blob'`). */
  async exportCsv(query: ListStudentsQueryDto): Promise<string> {
    const { items } = await this.list({ ...query, page: 1, pageSize: 10_000 });
    const header = [
      'Admission Number',
      'Name',
      'Class',
      'Section',
      'Status',
      'Date of Birth',
      'Gender',
    ];
    const rows = items.map((s) =>
      [
        s.admissionNumber,
        s.name,
        s.classId,
        s.sectionId,
        s.status,
        s.dob,
        s.gender,
      ]
        .map(csvEscape)
        .join(','),
    );
    return [header.map(csvEscape).join(','), ...rows].join('\n');
  }

  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'StudentsService called with no tenant in request context',
      );
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<Student> {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) {
      throw new NotFoundException(`Student ${id} not found`);
    }
    return student;
  }

  private async assertPlacementValid(
    classId: string,
    sectionId: string,
    academicYearId: string,
  ): Promise<void> {
    const [schoolClass, section, academicYear] = await Promise.all([
      this.prisma.schoolClass.findUnique({ where: { id: classId } }),
      this.prisma.section.findUnique({ where: { id: sectionId } }),
      this.prisma.academicYear.findUnique({ where: { id: academicYearId } }),
    ]);
    if (!schoolClass) {
      throw new BadRequestException(`Class ${classId} not found`);
    }
    if (!section || section.classId !== classId) {
      throw new BadRequestException(
        `Section ${sectionId} not found in class ${classId}`,
      );
    }
    if (!academicYear) {
      throw new BadRequestException(
        `Academic year ${academicYearId} not found`,
      );
    }
  }

  /** Postgres unique-violation (`P2002` on `[tenantId, admissionNumber]`) → a clear 409. */
  private async wrapUniqueViolation<T>(
    admissionNumber: string,
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
          `Admission number "${admissionNumber}" is already in use`,
        );
      }
      throw error;
    }
  }

  private async toResponse(student: Student): Promise<StudentResponseDto> {
    const [enrollments, subjects, documents, familyLinks] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.subject.findMany({
        where: { classIds: { has: student.classId } },
        select: { id: true, name: true },
      }),
      this.prisma.document.findMany({
        where: { category: 'student', ownerId: student.id },
        include: {
          versions: { orderBy: { version: 'desc' as const }, take: 1 },
        },
      }),
      this.prisma.parentStudentLink.findMany({
        where: { studentId: student.id },
        include: { parent: true },
      }),
    ]);

    const parentIds = familyLinks.map((link) => link.parentId);
    const siblingLinks = parentIds.length
      ? await this.prisma.parentStudentLink.findMany({
          where: {
            parentId: { in: parentIds },
            studentId: { not: student.id },
          },
          include: { student: true },
        })
      : [];
    const siblings = new Map<string, FamilyLinkDto>();
    for (const link of siblingLinks) {
      // `FamilyLink.relation` for a sibling isn't a real relation type (there's no "how is this
      // sibling related to me" concept, only "how is each of us related to the shared parent") —
      // a fixed label, not the shared parent's `relation` value, keeps this honest rather than
      // showing e.g. "(father)" next to a sibling's name.
      siblings.set(link.studentId, {
        id: link.student.id,
        name: link.student.name,
        relation: 'sibling',
      });
    }

    return {
      id: student.id,
      admissionNumber: student.admissionNumber,
      name: student.name,
      photoUrl: student.photoUrl,
      dob: formatDateOnly(student.dob),
      gender: student.gender,
      address: student.address,
      nationality: student.nationality,
      language: student.language,
      classId: student.classId,
      sectionId: student.sectionId,
      academicYearId: student.academicYearId,
      status: student.status,
      medicalInfo: student.medicalInfo,
      emergencyContacts: (student.emergencyContacts ??
        []) as unknown as StudentResponseDto['emergencyContacts'],
      enrollmentHistory: enrollments.map((e) => ({
        academicYearId: e.academicYearId,
        classId: e.classId,
        sectionId: e.sectionId,
      })),
      subjects: subjects satisfies StudentSubjectDto[],
      classTeacherId: null,
      documents: await Promise.all(
        documents.map(async (d): Promise<StudentDocumentDto> => ({
          id: d.id,
          name: d.versions[0].fileName,
          url: await this.storage.getSignedDownloadUrl(
            d.versions[0].storageKey,
          ),
          uploadedAt: d.versions[0].createdAt.toISOString(),
        })),
      ),
      parents: familyLinks
        .filter((link) => link.relation !== 'guardian')
        .map((link) => toFamilyLink(link)),
      guardians: familyLinks
        .filter((link) => link.relation === 'guardian')
        .map((link) => toFamilyLink(link)),
      siblings: [...siblings.values()],
    };
  }
}

function toStudentData(dto: StudentDto) {
  return {
    admissionNumber: dto.admissionNumber,
    name: dto.name,
    dob: parseDateOnly(dto.dob),
    gender: dto.gender,
    address: dto.address,
    nationality: dto.nationality,
    language: dto.language,
    classId: dto.classId,
    sectionId: dto.sectionId,
    academicYearId: dto.academicYearId,
    status: dto.status,
    medicalInfo: dto.medicalInfo,
    // Plain objects, not the DTO's class instances — Prisma's `InputJsonValue` needs a structural
    // index signature a `class-validator`-decorated class doesn't have.
    emergencyContacts: dto.emergencyContacts.map((c) => ({
      name: c.name,
      relation: c.relation,
      phone: c.phone,
    })) as Prisma.InputJsonValue,
  };
}

function toFamilyLink(link: {
  parentId: string;
  relation: string;
  parent: { id: string; name: string };
}): FamilyLinkDto {
  return {
    id: link.parent.id,
    name: link.parent.name,
    relation: link.relation,
  };
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
