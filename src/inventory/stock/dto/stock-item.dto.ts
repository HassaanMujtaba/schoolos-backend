import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * One shape for both create and edit, matching `schemas.ts`'s `stockItemSchema` field-for-field.
 * `quantity` is accepted here (the create path needs it) but ignored by `StockItemsService.update`
 * once the item exists — see that model's own doc comment; `StockForm.tsx` disables the field on
 * edit and this is the server-side half of that same contract.
 */
export class StockItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Category is required' })
  categoryId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Unit is required' })
  @MaxLength(30)
  unit!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'Quantity cannot be negative' })
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'Threshold cannot be negative' })
  lowStockThreshold!: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  notes!: string;
}
