import { ApiProperty } from '@nestjs/swagger';
import {
  AllocationStatus,
  ComplaintCategory,
  HostelType,
  RoomType,
} from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';
import { COMPLAINT_STATUSES, ComplaintStatus } from './complaint.dto';

/** `frontend/src/features/hostel/api.ts`'s `Hostel`. */
export class HostelResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: HostelType }) type!: HostelType;
  @ApiProperty() address!: string;
  @ApiProperty() wardenName!: string;
  @ApiProperty() notes!: string;
}

export class PagedHostelsDto implements PagedResult<HostelResponseDto> {
  @ApiProperty({ type: [HostelResponseDto] }) items!: HostelResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `Room` — `occupiedBeds` is server-computed (`schema.prisma`'s own doc comment). */
export class RoomResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hostelId!: string;
  @ApiProperty() floorLabel!: string;
  @ApiProperty() roomNumber!: string;
  @ApiProperty() capacity!: number;
  @ApiProperty({ enum: RoomType }) roomType!: RoomType;
  @ApiProperty() occupiedBeds!: number;
}

export class PagedRoomsDto implements PagedResult<RoomResponseDto> {
  @ApiProperty({ type: [RoomResponseDto] }) items!: RoomResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `RoomOccupant`. */
export class RoomOccupantDto {
  @ApiProperty() allocationId!: string;
  @ApiProperty() bedNumber!: number;
  @ApiProperty() studentId!: string;
  @ApiProperty() studentLabel!: string;
  @ApiProperty() allocatedAt!: string;
}

/** `api.ts`'s `RoomOccupancy` — `AllocationDesk`'s bed grid. */
export class RoomOccupancyDto {
  @ApiProperty() roomId!: string;
  @ApiProperty() capacity!: number;
  @ApiProperty({ type: [RoomOccupantDto] }) occupants!: RoomOccupantDto[];
}

/** `api.ts`'s `Allocation` — `studentLabel`/`hostelName`/`roomLabel` always resolved server-side. */
export class AllocationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() studentId!: string;
  @ApiProperty() studentLabel!: string;
  @ApiProperty() hostelId!: string;
  @ApiProperty() hostelName!: string;
  @ApiProperty() roomId!: string;
  @ApiProperty() roomLabel!: string;
  @ApiProperty() bedNumber!: number;
  @ApiProperty() allocatedAt!: string;
  @ApiProperty({ nullable: true, type: String }) vacatedAt!: string | null;
  @ApiProperty({ enum: AllocationStatus }) status!: AllocationStatus;
}

export class PagedAllocationsDto implements PagedResult<AllocationResponseDto> {
  @ApiProperty({ type: [AllocationResponseDto] })
  items!: AllocationResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `Visitor`. */
export class VisitorResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() residentStudentId!: string;
  @ApiProperty() residentLabel!: string;
  @ApiProperty() visitorName!: string;
  @ApiProperty() relation!: string;
  @ApiProperty() purpose!: string;
  @ApiProperty() checkInAt!: string;
  @ApiProperty({ nullable: true, type: String }) checkOutAt!: string | null;
}

export class PagedVisitorsDto implements PagedResult<VisitorResponseDto> {
  @ApiProperty({ type: [VisitorResponseDto] }) items!: VisitorResponseDto[];
  @ApiProperty() total!: number;
}

/** `api.ts`'s `Complaint`. */
export class ComplaintResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hostelId!: string;
  @ApiProperty() hostelName!: string;
  @ApiProperty({ nullable: true, type: String }) roomId!: string | null;
  @ApiProperty({ nullable: true, type: String }) roomLabel!: string | null;
  @ApiProperty({ nullable: true, type: String })
  residentStudentId!: string | null;
  @ApiProperty({ nullable: true, type: String }) residentLabel!: string | null;
  @ApiProperty({ enum: ComplaintCategory }) category!: ComplaintCategory;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: COMPLAINT_STATUSES }) status!: ComplaintStatus;
  @ApiProperty({ nullable: true, type: String }) resolutionNotes!:
    string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) resolvedAt!: string | null;
}

export class PagedComplaintsDto implements PagedResult<ComplaintResponseDto> {
  @ApiProperty({ type: [ComplaintResponseDto] })
  items!: ComplaintResponseDto[];
  @ApiProperty() total!: number;
}
