import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeeStructure, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { FeeStructureDto } from './dto/fee-structure.dto';
import { ListFeeStructuresQueryDto } from './dto/list-fee-structures-query.dto';
import { FeeStructureResponseDto } from './dto/fee-response.dto';
import { DiscountRule } from './fee-calc';

/**
 * `frontend/src/features/fees/api.ts`'s fee-structure surface (`modules/fees.md` "Fee
 * structures"). `applicableClasses` is a plain string array, same trade-off `Subject.classIds`
 * already makes (referential integrity enforced here, not by a DB foreign key);
 * `discountRules` is JSON, same never-queried-individually trade-off as `Student.
 * emergencyContacts` — see `FeeStructure`'s own schema.prisma doc comment.
 */
@Injectable()
export class FeeStructuresService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListFeeStructuresQueryDto,
  ): Promise<PagedResult<FeeStructureResponseDto>> {
    const where: Prisma.FeeStructureWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.feeStructure.findMany({
          where,
          orderBy: { name: 'asc' },
          skip,
          take,
        }),
      () => this.prisma.feeStructure.count({ where }),
    );
    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<FeeStructureResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  /** Real `FeeStructure` row, for callers (`InvoicesService`) that need the raw discount rules. */
  async findEntityOrThrow(id: string): Promise<FeeStructure> {
    return this.findOrThrow(id);
  }

  async create(dto: FeeStructureDto): Promise<FeeStructureResponseDto> {
    await this.assertClassesExist(dto.applicableClasses);
    const structure = await this.prisma.feeStructure.create({
      data: toData(dto) as unknown as Prisma.FeeStructureUncheckedCreateInput,
    });
    return toResponse(structure);
  }

  async update(
    id: string,
    dto: FeeStructureDto,
  ): Promise<FeeStructureResponseDto> {
    await this.findOrThrow(id);
    await this.assertClassesExist(dto.applicableClasses);
    const structure = await this.prisma.feeStructure.update({
      where: { id },
      data: toData(dto),
    });
    return toResponse(structure);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    const invoiceCount = await this.prisma.invoice.count({
      where: { feeStructureId: id },
    });
    if (invoiceCount > 0) {
      throw new ConflictException(
        `Fee structure ${id} has ${invoiceCount} invoice(s) generated against it and cannot be deleted`,
      );
    }
    await this.prisma.feeStructure.delete({ where: { id } });
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

  private async findOrThrow(id: string): Promise<FeeStructure> {
    const structure = await this.prisma.feeStructure.findUnique({
      where: { id },
    });
    if (!structure) {
      throw new NotFoundException(`Fee structure ${id} not found`);
    }
    return structure;
  }
}

function toData(dto: FeeStructureDto) {
  return {
    name: dto.name,
    type: dto.type,
    amount: dto.amount,
    applicableClasses: dto.applicableClasses,
    discountRules: dto.discountRules as unknown as Prisma.InputJsonValue,
  };
}

export function discountRulesOf(structure: FeeStructure): DiscountRule[] {
  return (structure.discountRules as unknown as DiscountRule[]) ?? [];
}

function toResponse(structure: FeeStructure): FeeStructureResponseDto {
  return {
    id: structure.id,
    name: structure.name,
    type: structure.type,
    amount: structure.amount,
    applicableClasses: structure.applicableClasses,
    discountRules: discountRulesOf(structure),
  };
}
