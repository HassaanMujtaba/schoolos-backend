import { ApiProperty } from '@nestjs/swagger';
import { VehicleStatus, VehicleType } from '@prisma/client';

/** A nested maintenance-record item as returned to the client — `id` is additive (not in `frontend`'s `maintenanceRecordSchema`, but harmless to include and useful as a stable `useFieldArray` key), same convention `BranchResponseDto`'s `NamedChildDto` already set. */
export class MaintenanceRecordResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() date!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ required: false }) cost?: number;
}

/** `documents/api.ts`'s document shape, resolved the same real way `StudentDocumentDto` already
 * is (category + ownerId) — see `schema.prisma`'s `DocumentCategory.vehicle` doc comment. */
export class VehicleDocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() url!: string;
  @ApiProperty() uploadedAt!: string;
}

/** `GET/POST/PATCH /transport/vehicles` response — `frontend/src/features/transport/api.ts`'s `Vehicle`. */
export class VehicleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() registrationNumber!: string;
  @ApiProperty({ enum: VehicleType }) type!: VehicleType;
  @ApiProperty() capacity!: number;
  @ApiProperty({ enum: VehicleStatus }) status!: VehicleStatus;
  @ApiProperty() driverName!: string;
  @ApiProperty() driverPhone!: string;
  @ApiProperty() insuranceProvider!: string;
  @ApiProperty() insuranceExpiryDate!: string;
  @ApiProperty({ type: [MaintenanceRecordResponseDto] })
  maintenanceRecords!: MaintenanceRecordResponseDto[];
  @ApiProperty({ type: [VehicleDocumentDto] }) documents!: VehicleDocumentDto[];
}

export class PagedVehiclesDto {
  @ApiProperty({ type: [VehicleResponseDto] }) items!: VehicleResponseDto[];
  @ApiProperty() total!: number;
}
