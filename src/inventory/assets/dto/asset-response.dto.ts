import { ApiProperty } from '@nestjs/swagger';
import { AssetCategory } from '@prisma/client';
import { PagedResult } from '../../../common/pagination/list-query.dto';
import { ASSET_STATUSES, AssetStatus } from './asset.dto';

/** A nested maintenance-record item as returned to the client — `id` is additive (not in
 * `schemas.ts`'s `assetMaintenanceRecordSchema`, harmless and useful as a stable `useFieldArray`
 * key), same convention `transport`'s `MaintenanceRecordResponseDto` already set. */
export class AssetMaintenanceRecordResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() date!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ required: false }) cost?: number;
}

/** `GET/POST/PATCH /assets` response — `frontend/src/features/inventory/api.ts`'s `Asset`. */
export class AssetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() assetCode!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: AssetCategory }) category!: AssetCategory;
  @ApiProperty({ enum: ASSET_STATUSES }) status!: AssetStatus;
  @ApiProperty() purchaseDate!: string;
  @ApiProperty() purchaseCost!: number;
  @ApiProperty() usefulLifeYears!: number;
  @ApiProperty() location!: string;
  @ApiProperty() assignedTo!: string;
  @ApiProperty() warrantyExpiryDate!: string;
  @ApiProperty({ type: [AssetMaintenanceRecordResponseDto] })
  maintenanceRecords!: AssetMaintenanceRecordResponseDto[];
  @ApiProperty() disposalDate!: string;
  @ApiProperty() disposalReason!: string;
  @ApiProperty({ required: false }) disposalValue?: number;
}

export class PagedAssetsDto implements PagedResult<AssetResponseDto> {
  @ApiProperty({ type: [AssetResponseDto] }) items!: AssetResponseDto[];
  @ApiProperty() total!: number;
}
