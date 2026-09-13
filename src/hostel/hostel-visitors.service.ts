import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Visitor } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { ListVisitorsQueryDto, VisitorDto } from './dto/visitor.dto';
import {
  PagedVisitorsDto,
  VisitorResponseDto,
} from './dto/hostel-response.dto';

/**
 * `frontend/src/features/hostel/api.ts`'s visitor log surface — `hostel.manage` gates both
 * check-in and check-out (the module doc's own catalog doesn't carve out a separate permission
 * for this). `checkInAt`/`checkOutAt` are full timestamps, not date-only (`schema.prisma`'s own
 * doc comment) — a visitor log records the actual time on the premises.
 */
@Injectable()
export class HostelVisitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListVisitorsQueryDto): Promise<PagedVisitorsDto> {
    const where: Prisma.VisitorWhereInput = {
      ...(query.open === 'true' ? { checkOutAt: null } : {}),
      ...(query.open === 'false' ? { checkOutAt: { not: null } } : {}),
      ...(query.search
        ? {
            OR: [
              { visitorName: { contains: query.search, mode: 'insensitive' } },
              {
                residentLabel: { contains: query.search, mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.visitor.findMany({
          where,
          orderBy: { checkInAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.visitor.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async checkIn(dto: VisitorDto): Promise<VisitorResponseDto> {
    await this.assertStudentExists(dto.residentStudentId);
    const visitor = await this.prisma.visitor.create({
      data: {
        residentStudentId: dto.residentStudentId,
        residentLabel: dto.residentLabel,
        visitorName: dto.visitorName,
        relation: dto.relation,
        purpose: dto.purpose,
      } as unknown as Prisma.VisitorUncheckedCreateInput,
    });
    return toResponse(visitor);
  }

  async checkOut(id: string): Promise<VisitorResponseDto> {
    const visitor = await this.findOrThrow(id);
    if (visitor.checkOutAt) {
      throw new ConflictException(`Visitor ${id} is already checked out`);
    }
    const updated = await this.prisma.visitor.update({
      where: { id },
      data: { checkOutAt: new Date() },
    });
    return toResponse(updated);
  }

  private async assertStudentExists(studentId: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new BadRequestException(`Student ${studentId} not found`);
    }
  }

  private async findOrThrow(id: string): Promise<Visitor> {
    const visitor = await this.prisma.visitor.findUnique({ where: { id } });
    if (!visitor) {
      throw new NotFoundException(`Visitor ${id} not found`);
    }
    return visitor;
  }
}

function toResponse(visitor: Visitor): VisitorResponseDto {
  return {
    id: visitor.id,
    residentStudentId: visitor.residentStudentId,
    residentLabel: visitor.residentLabel,
    visitorName: visitor.visitorName,
    relation: visitor.relation,
    purpose: visitor.purpose,
    checkInAt: visitor.checkInAt.toISOString(),
    checkOutAt: visitor.checkOutAt ? visitor.checkOutAt.toISOString() : null,
  };
}
