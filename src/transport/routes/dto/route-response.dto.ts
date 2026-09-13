import { ApiProperty } from '@nestjs/swagger';

/** A nested stop item as returned to the client — `id` is additive, same convention as `BranchResponseDto`'s `NamedChildDto`/`VehicleResponseDto`'s `MaintenanceRecordResponseDto`. */
export class RouteStopResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() time!: string;
}

/** `GET/POST/PATCH /transport/routes` response — `frontend/src/features/transport/api.ts`'s `TransportRoute`. */
export class RouteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() vehicleId!: string;
  @ApiProperty() driverName!: string;
  @ApiProperty() attendantName!: string;
  @ApiProperty() feeStructureId!: string;
  @ApiProperty({ type: [RouteStopResponseDto] }) stops!: RouteStopResponseDto[];
  @ApiProperty({ type: [String] }) studentIds!: string[];
}

export class PagedRoutesDto {
  @ApiProperty({ type: [RouteResponseDto] }) items!: RouteResponseDto[];
  @ApiProperty() total!: number;
}
