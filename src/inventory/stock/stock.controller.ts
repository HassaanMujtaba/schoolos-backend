import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { StockService } from './stock.service';
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

/**
 * `frontend/src/features/inventory/api.ts`'s stock surface (`modules/inventory.md` "Backend
 * dependencies") — `inventory.read`/`inventory.manage` gating, same two-permission shape
 * `VehiclesController` already set (this module doesn't split into per-action permission strings
 * either).
 */
@ApiTags('inventory-stock')
@Controller('inventory')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('stock-categories')
  @RequirePermission('inventory.read')
  listCategories(): Promise<ReferenceEntryResponseDto[]> {
    return this.stock.listCategories();
  }

  @Post('stock-categories')
  @RequirePermission('inventory.manage')
  createCategory(
    @Body() dto: ReferenceEntryDto,
  ): Promise<ReferenceEntryResponseDto> {
    return this.stock.createCategory(dto);
  }

  @Delete('stock-categories/:id')
  @RequirePermission('inventory.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@Param('id') id: string): Promise<void> {
    return this.stock.deleteCategory(id);
  }

  @Get('stock')
  @RequirePermission('inventory.read')
  list(@Query() query: ListStockQueryDto): Promise<PagedStockItemsDto> {
    return this.stock.list(query);
  }

  @Post('stock')
  @RequirePermission('inventory.manage')
  create(@Body() dto: StockItemDto): Promise<StockItemResponseDto> {
    return this.stock.create(dto);
  }

  @Patch('stock/:id')
  @RequirePermission('inventory.manage')
  update(
    @Param('id') id: string,
    @Body() dto: StockItemDto,
  ): Promise<StockItemResponseDto> {
    return this.stock.update(id, dto);
  }

  @Delete('stock/:id')
  @RequirePermission('inventory.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.stock.remove(id);
  }

  @Get('stock/:id/movements')
  @RequirePermission('inventory.read')
  listMovements(@Param('id') id: string): Promise<StockMovementResponseDto[]> {
    return this.stock.listMovements(id);
  }

  @Post('stock/:id/movements')
  @RequirePermission('inventory.manage')
  recordMovement(
    @Param('id') id: string,
    @Body() dto: StockMovementDto,
  ): Promise<StockItemResponseDto> {
    return this.stock.recordMovement(id, dto);
  }
}
