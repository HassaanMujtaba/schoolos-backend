import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SchoolClass } from '@prisma/client';
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
import { ClassDto } from './dto/class.dto';
import { ClassResponseDto } from './dto/class-response.dto';

const SORTABLE_FIELDS = ['name', 'gradeLevel', 'createdAt'] as const;

/** `frontend/src/features/school-setup/api.ts`'s classes surface. */
@Injectable()
export class ClassesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQueryDto): Promise<PagedResult<ClassResponseDto>> {
    const where: Prisma.SchoolClassWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const sortBy = resolveSortField(
      query.sortBy,
      SORTABLE_FIELDS,
      'gradeLevel',
    );
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.schoolClass.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.schoolClass.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<ClassResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: ClassDto): Promise<ClassResponseDto> {
    // `tenantId` is injected by PrismaService's tenant-scoping extension at runtime — see
    // `BranchesService.create`'s identical comment.
    const schoolClass = await this.prisma.schoolClass.create({
      data: {
        name: dto.name,
        gradeLevel: dto.gradeLevel ?? null,
      } as unknown as Prisma.SchoolClassUncheckedCreateInput,
    });
    return toResponse(schoolClass);
  }

  async update(id: string, dto: ClassDto): Promise<ClassResponseDto> {
    await this.findOrThrow(id);
    const schoolClass = await this.prisma.schoolClass.update({
      where: { id },
      data: { name: dto.name, gradeLevel: dto.gradeLevel ?? null },
    });
    return toResponse(schoolClass);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.schoolClass.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<SchoolClass> {
    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id },
    });
    if (!schoolClass) {
      throw new NotFoundException(`Class ${id} not found`);
    }
    return schoolClass;
  }
}

function toResponse(schoolClass: SchoolClass): ClassResponseDto {
  return {
    id: schoolClass.id,
    name: schoolClass.name,
    gradeLevel: schoolClass.gradeLevel ?? undefined,
  };
}
