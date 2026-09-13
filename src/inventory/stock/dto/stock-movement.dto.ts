import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  MaxLength,
  NotEquals,
} from 'class-validator';
import { StockMovementType } from '@prisma/client';

/**
 * `schemas.ts`'s `stockMovementSchema` — `StockAdjustmentDialog` has already flipped the sign
 * (positive for a restock, negative for an issue/adjustment) before this ever reaches the server,
 * so `quantityChange` is accepted as a signed delta and applied to `StockItem.quantity` as-is
 * (`StockItemsService.recordMovement`'s own doc comment) — never re-derived from `type` here.
 */
export class StockMovementDto {
  @ApiProperty({ enum: StockMovementType })
  @IsEnum(StockMovementType)
  type!: StockMovementType;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @NotEquals(0, { message: 'Enter a non-zero quantity' })
  quantityChange!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  issuedTo!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  reason!: string;

  @ApiProperty()
  @IsDateString({ strict: false }, { message: 'Date is required' })
  date!: string;
}
