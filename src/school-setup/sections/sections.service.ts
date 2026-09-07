import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Section } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PagedResult } from '../../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../../common/pagination/paginate';
import { ListSectionsQueryDto } from './dto/list-sections-query.dto';
import { SectionDto } from './dto/section.dto';
import { SectionResponseDto } from './dto/section-response.dto';

const SORTABLE_FIELDS = ['name', 'createdAt'] as const;

/** `frontend/src/features/school-setup/api.ts`'s sections surface. */
@Injectable()
export class SectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListSectionsQueryDto,
  ): Promise<PagedResult<SectionResponseDto>> {
    const where: Prisma.SectionWhereInput = {
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.section.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.section.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<SectionResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: SectionDto): Promise<SectionResponseDto> {
    await this.assertClassExists(dto.classId);
    // `tenantId` is injected by PrismaService's tenant-scoping extension at runtime — see
    // `BranchesService.create`'s identical comment.
    const section = await this.prisma.section.create({
      data: {
        name: dto.name,
        classId: dto.classId,
        classTeacherName: dto.classTeacherName,
        roomLabel: dto.roomLabel,
      } as unknown as Prisma.SectionUncheckedCreateInput,
    });
    return toResponse(section);
  }

  async update(id: string, dto: SectionDto): Promise<SectionResponseDto> {
    await this.findOrThrow(id);
    await this.assertClassExists(dto.classId);
    const section = await this.prisma.section.update({
      where: { id },
      data: {
        name: dto.name,
        classId: dto.classId,
        classTeacherName: dto.classTeacherName,
        roomLabel: dto.roomLabel,
      },
    });
    return toResponse(section);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.section.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<Section> {
    const section = await this.prisma.section.findUnique({ where: { id } });
    if (!section) {
      throw new NotFoundException(`Section ${id} not found`);
    }
    return section;
  }

  /** `classId` has no DB foreign-key check across tenants by construction (tenant-scoped lookup) — this is what actually stops a section being pointed at another tenant's class, or one that doesn't exist. */
  private async assertClassExists(classId: string): Promise<void> {
    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: classId },
    });
    if (!schoolClass) {
      throw new BadRequestException(`Class ${classId} not found`);
    }
  }
}

function toResponse(section: Section): SectionResponseDto {
  return {
    id: section.id,
    name: section.name,
    classId: section.classId,
    classTeacherName: section.classTeacherName,
    roomLabel: section.roomLabel,
  };
}
