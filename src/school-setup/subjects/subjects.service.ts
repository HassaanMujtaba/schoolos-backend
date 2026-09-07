import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Subject } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  PagedResult,
  ListQueryDto,
} from '../../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../../common/pagination/paginate';
import { SubjectDto } from './dto/subject.dto';
import { SubjectResponseDto } from './dto/subject-response.dto';

const SORTABLE_FIELDS = ['name', 'code', 'createdAt'] as const;

/**
 * `frontend/src/features/school-setup/api.ts`'s subjects surface. `classIds` is a plain string
 * array (see `schema.prisma`'s own note on `Subject.classIds`), so referential integrity against
 * `SchoolClass` — and against cross-tenant ids — is enforced here, not by a DB foreign key.
 */
@Injectable()
export class SubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQueryDto): Promise<PagedResult<SubjectResponseDto>> {
    const where: Prisma.SubjectWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.subject.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.subject.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<SubjectResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: SubjectDto): Promise<SubjectResponseDto> {
    await this.assertClassesExist(dto.classIds);
    // `tenantId` is injected by PrismaService's tenant-scoping extension at runtime — see
    // `BranchesService.create`'s identical comment.
    const subject = await this.prisma.subject.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        classIds: dto.classIds,
      } as unknown as Prisma.SubjectUncheckedCreateInput,
    });
    return toResponse(subject);
  }

  async update(id: string, dto: SubjectDto): Promise<SubjectResponseDto> {
    await this.findOrThrow(id);
    await this.assertClassesExist(dto.classIds);
    const subject = await this.prisma.subject.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        classIds: dto.classIds,
      },
    });
    return toResponse(subject);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.subject.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<Subject> {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject) {
      throw new NotFoundException(`Subject ${id} not found`);
    }
    return subject;
  }

  private async assertClassesExist(classIds: string[]): Promise<void> {
    if (classIds.length === 0) return;
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
}

function toResponse(subject: Subject): SubjectResponseDto {
  return {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    type: subject.type,
    classIds: subject.classIds,
  };
}
