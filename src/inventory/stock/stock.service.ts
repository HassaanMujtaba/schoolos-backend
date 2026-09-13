import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockItem } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContextService } from '../../common/context/request-context.service';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../../common/dates/date-only';
import { ReferenceEntryDto } from './dto/reference-entry.dto';
import { StockItemDto } from './dto/stock-item.dto';
import { ListStockQueryDto } from './dto/list-stock-query.dto';
import { StockMovementDto } from './dto/stock-movement.dto';
import {
  PagedStockItemsDto,
  ReferenceEntryResponseDto,
  StockItemResponseDto,
  StockMovementResponseDto,
} from './dto/stock-response.dto';

const SORTABLE_FIELDS = [
  'name',
  'quantity',
  'lowStockThreshold',
  'createdAt',
] as const;

/**
 * `frontend/src/features/inventory/api.ts`'s stock surface (`modules/inventory.md` "Backend
 * dependencies"). Categories are a lightweight add/delete-only reference list, same shape as
 * `LibraryCatalogService`'s categories/shelves — no update endpoint, matching `api.ts` exactly and
 * no referential block on delete either (a stock item's `categoryId` is a plain string column, not
 * an FK, same "peer entity" trade-off `Book.categoryId` already makes).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  // ---------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------

  async listCategories(): Promise<ReferenceEntryResponseDto[]> {
    return this.prisma.stockCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(
    dto: ReferenceEntryDto,
  ): Promise<ReferenceEntryResponseDto> {
    return this.prisma.stockCategory.create({
      data: {
        name: dto.name,
      } as unknown as Prisma.StockCategoryUncheckedCreateInput,
    });
  }

  async deleteCategory(id: string): Promise<void> {
    const category = await this.prisma.stockCategory.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(`Category ${id} not found`);
    }
    await this.prisma.stockCategory.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------
  // Stock items
  // ---------------------------------------------------------------------

  async list(query: ListStockQueryDto): Promise<PagedStockItemsDto> {
    const where: Prisma.StockItemWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.stockItem.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.stockItem.count({ where }),
    );

    return {
      items: result.items.map(toStockItemResponse),
      total: result.total,
    };
  }

  async create(dto: StockItemDto): Promise<StockItemResponseDto> {
    await this.assertCategoryExists(dto.categoryId);
    const item = await this.prisma.stockItem.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        unit: dto.unit,
        quantity: dto.quantity,
        lowStockThreshold: dto.lowStockThreshold,
        unitCost: dto.unitCost ?? null,
        notes: dto.notes,
      } as unknown as Prisma.StockItemUncheckedCreateInput,
    });
    return toStockItemResponse(item);
  }

  /** `quantity` is deliberately ignored here — see this service's own class-level doc comment; the stored value survives untouched, only `POST .../movements` ever changes it. */
  async update(id: string, dto: StockItemDto): Promise<StockItemResponseDto> {
    await this.findItemOrThrow(id);
    await this.assertCategoryExists(dto.categoryId);
    const item = await this.prisma.stockItem.update({
      where: { id },
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        unit: dto.unit,
        lowStockThreshold: dto.lowStockThreshold,
        unitCost: dto.unitCost ?? null,
        notes: dto.notes,
      },
    });
    return toStockItemResponse(item);
  }

  async remove(id: string): Promise<void> {
    await this.findItemOrThrow(id);
    await this.prisma.stockItem.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------
  // Movements
  // ---------------------------------------------------------------------

  async listMovements(
    stockItemId: string,
  ): Promise<StockMovementResponseDto[]> {
    await this.findItemOrThrow(stockItemId);
    const movements = await this.prisma.stockMovement.findMany({
      where: { stockItemId },
      orderBy: { date: 'desc' },
    });
    return movements.map(toMovementResponse);
  }

  /**
   * `StockAdjustmentDialog`'s one mutation path — applies the (already signed) `quantityChange`
   * to `StockItem.quantity` in the same transaction that logs the movement, rejecting a change
   * that would take stock negative rather than clamping it, so the log and the running total never
   * disagree.
   */
  async recordMovement(
    stockItemId: string,
    dto: StockMovementDto,
  ): Promise<StockItemResponseDto> {
    const item = await this.findItemOrThrow(stockItemId);
    const newQuantity = item.quantity + dto.quantityChange;
    if (newQuantity < 0) {
      throw new BadRequestException(
        `This movement would take "${item.name}" below zero (currently ${item.quantity})`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          stockItemId,
          type: dto.type,
          quantityChange: dto.quantityChange,
          issuedTo: dto.issuedTo,
          reason: dto.reason,
          date: parseDateOnly(dto.date),
        } as unknown as Prisma.StockMovementUncheckedCreateInput,
      });
      return tx.stockItem.update({
        where: { id: stockItemId },
        data: { quantity: newQuantity },
      });
    });

    return toStockItemResponse(updated);
  }

  // ---------------------------------------------------------------------

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.stockCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new BadRequestException(`Category ${categoryId} not found`);
    }
  }

  private async findItemOrThrow(id: string): Promise<StockItem> {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Stock item ${id} not found`);
    }
    return item;
  }
}

function toStockItemResponse(item: StockItem): StockItemResponseDto {
  return {
    id: item.id,
    name: item.name,
    categoryId: item.categoryId,
    unit: item.unit,
    quantity: item.quantity,
    lowStockThreshold: item.lowStockThreshold,
    unitCost: item.unitCost ?? undefined,
    notes: item.notes,
  };
}

function toMovementResponse(movement: {
  id: string;
  stockItemId: string;
  type: string;
  quantityChange: number;
  issuedTo: string;
  reason: string;
  date: Date;
}): StockMovementResponseDto {
  return {
    id: movement.id,
    stockItemId: movement.stockItemId,
    type: movement.type,
    quantityChange: movement.quantityChange,
    issuedTo: movement.issuedTo,
    reason: movement.reason,
    date: formatDateOnly(movement.date),
  };
}
