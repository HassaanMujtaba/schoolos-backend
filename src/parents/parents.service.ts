import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Parent, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../common/pagination/paginate';
import { ParentDto } from './dto/parent.dto';
import { LinkChildDto } from './dto/link-child.dto';
import { ChildDto, ParentResponseDto } from './dto/parent-response.dto';

const SORTABLE_FIELDS = ['name', 'createdAt'] as const;

/** `frontend/src/features/parents/api.ts`'s surface — §9, admin CRUD + child-linking. */
@Injectable()
export class ParentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQueryDto): Promise<PagedResult<ParentResponseDto>> {
    const where: Prisma.ParentWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.parent.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.parent.count({ where }),
    );

    return {
      items: await Promise.all(result.items.map((p) => this.toResponse(p))),
      total: result.total,
    };
  }

  async get(id: string): Promise<ParentResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async create(dto: ParentDto): Promise<ParentResponseDto> {
    // `tenantId` is injected by PrismaService's tenant-scoping extension at runtime — see
    // `BranchesService.create`'s identical comment.
    const parent = await this.prisma.parent.create({
      data: { ...dto } as unknown as Prisma.ParentUncheckedCreateInput,
    });
    return this.toResponse(parent);
  }

  async update(id: string, dto: ParentDto): Promise<ParentResponseDto> {
    await this.findOrThrow(id);
    const parent = await this.prisma.parent.update({
      where: { id },
      data: { ...dto },
    });
    return this.toResponse(parent);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.parent.delete({ where: { id } });
  }

  async linkChild(parentId: string, dto: LinkChildDto): Promise<ChildDto> {
    await this.findOrThrow(parentId);
    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
    });
    if (!student) {
      throw new NotFoundException(`Student ${dto.studentId} not found`);
    }

    try {
      await this.prisma.parentStudentLink.create({
        data: {
          parentId,
          studentId: dto.studentId,
          relation: dto.relation,
        } as unknown as Prisma.ParentStudentLinkUncheckedCreateInput,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `${student.name} is already linked to this parent`,
        );
      }
      throw error;
    }

    return {
      id: student.id,
      name: student.name,
      admissionNumber: student.admissionNumber,
      classId: student.classId,
      sectionId: student.sectionId,
      relation: dto.relation,
    };
  }

  async unlinkChild(parentId: string, studentId: string): Promise<void> {
    const link = await this.prisma.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId, studentId } },
    });
    if (!link) {
      throw new NotFoundException(
        `Student ${studentId} is not linked to parent ${parentId}`,
      );
    }
    await this.prisma.parentStudentLink.delete({ where: { id: link.id } });
  }

  /**
   * Portal child-switcher's "who am I the parent of" (`parents.md`'s "Portal: child switcher").
   * 404s for every caller today — nothing provisions `Parent.userId` yet, see that field's own
   * schema doc comment. Once a real "invite parent to the portal" flow exists, this needs no
   * change: it already resolves entirely from the authenticated user's id.
   */
  async getMyChildren(userId: string): Promise<ChildDto[]> {
    const parent = await this.prisma.parent.findUnique({ where: { userId } });
    if (!parent) {
      throw new NotFoundException('No parent profile linked to this account');
    }
    return (await this.toResponse(parent)).children;
  }

  private async findOrThrow(id: string): Promise<Parent> {
    const parent = await this.prisma.parent.findUnique({ where: { id } });
    if (!parent) {
      throw new NotFoundException(`Parent ${id} not found`);
    }
    return parent;
  }

  private async toResponse(parent: Parent): Promise<ParentResponseDto> {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId: parent.id },
      include: { student: true },
    });
    return {
      id: parent.id,
      name: parent.name,
      email: parent.email,
      phone: parent.phone,
      address: parent.address,
      children: links.map((link) => ({
        id: link.student.id,
        name: link.student.name,
        admissionNumber: link.student.admissionNumber,
        classId: link.student.classId,
        sectionId: link.student.sectionId,
        relation: link.relation,
      })),
    };
  }
}
