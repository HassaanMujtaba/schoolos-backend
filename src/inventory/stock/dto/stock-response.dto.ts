import { ApiProperty } from '@nestjs/swagger';
import { PagedResult } from '../../../common/pagination/list-query.dto';

/** `frontend/src/features/inventory/api.ts`'s `StockCategory`. */
export class ReferenceEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** `api.ts`'s `StockItem`. */
export class StockItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() lowStockThreshold!: number;
  @ApiProperty({ required: false }) unitCost?: number;
  @ApiProperty() notes!: string;
}

export class PagedStockItemsDto implements PagedResult<StockItemResponseDto> {
  @ApiProperty({ type: [StockItemResponseDto] }) items!: StockItemResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `StockMovement`. */
export class StockMovementResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() stockItemId!: string;
  @ApiProperty({ enum: ['restock', 'issue', 'adjustment'] }) type!: string;
  @ApiProperty() quantityChange!: number;
  @ApiProperty() issuedTo!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() date!: string;
}
