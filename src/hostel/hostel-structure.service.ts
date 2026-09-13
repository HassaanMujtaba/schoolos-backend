import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Hostel, Prisma, Room } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../common/pagination/paginate';
import { formatDateOnly } from '../common/dates/date-only';
import { HostelDto } from './dto/hostel.dto';
import { ListRoomsQueryDto, RoomDto } from './dto/room.dto';
import {
  HostelResponseDto,
  PagedHostelsDto,
  PagedRoomsDto,
  RoomOccupancyDto,
  RoomOccupantDto,
  RoomResponseDto,
} from './dto/hostel-response.dto';

const HOSTEL_SORTABLE_FIELDS = ['name', 'type', 'createdAt'] as const;
const ROOM_SORTABLE_FIELDS = [
  'roomNumber',
  'capacity',
  'roomType',
  'createdAt',
] as const;

/**
 * `frontend/src/features/hostel/api.ts`'s hostel + room surface (`modules/hostel.md` "Backend
 * dependencies") — grouped in one service the same way `LibraryCatalogService` groups categories/
 * shelves/books/copies, since rooms are never meaningfully queried without their owning hostel in
 * mind. `occupiedBeds`/room occupancy are always computed here from active `Allocation` rows
 * (`schema.prisma`'s own doc comment) — `hostel.manage` gates every mutation, `hostel.read` every
 * read, matching the module doc's own permission catalog (allocation itself is a separate
 * `hostel.allocate` permission, gated in `HostelAllocationsService` instead).
 */
@Injectable()
export class HostelStructureService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Hostels
  // ---------------------------------------------------------------------

  async listHostels(query: ListQueryDto): Promise<PagedHostelsDto> {
    const where: Prisma.HostelWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const sortBy = resolveSortField(
      query.sortBy,
      HOSTEL_SORTABLE_FIELDS,
      'name',
    );
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.hostel.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.hostel.count({ where }),
    );

    return { items: result.items.map(toHostelResponse), total: result.total };
  }

  async createHostel(dto: HostelDto): Promise<HostelResponseDto> {
    const hostel = await this.prisma.hostel.create({
      data: {
        name: dto.name,
        type: dto.type,
        address: dto.address,
        wardenName: dto.wardenName,
        notes: dto.notes,
      } as unknown as Prisma.HostelUncheckedCreateInput,
    });
    return toHostelResponse(hostel);
  }

  async updateHostel(id: string, dto: HostelDto): Promise<HostelResponseDto> {
    await this.findHostelOrThrow(id);
    const hostel = await this.prisma.hostel.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        address: dto.address,
        wardenName: dto.wardenName,
        notes: dto.notes,
      },
    });
    return toHostelResponse(hostel);
  }

  async removeHostel(id: string): Promise<void> {
    await this.findHostelOrThrow(id);
    const roomCount = await this.prisma.room.count({ where: { hostelId: id } });
    if (roomCount > 0) {
      throw new ConflictException(
        `Hostel ${id} still has ${roomCount} room(s) registered — remove them first`,
      );
    }
    await this.prisma.hostel.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------
  // Rooms
  // ---------------------------------------------------------------------

  async listRooms(query: ListRoomsQueryDto): Promise<PagedRoomsDto> {
    const where: Prisma.RoomWhereInput = {
      ...(query.hostelId ? { hostelId: query.hostelId } : {}),
      ...(query.search
        ? { roomNumber: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const sortBy = resolveSortField(
      query.sortBy,
      ROOM_SORTABLE_FIELDS,
      'roomNumber',
    );
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.room.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.room.count({ where }),
    );

    const occupied = await this.occupiedBedCounts(
      result.items.map((r) => r.id),
    );
    return {
      items: result.items.map((r) =>
        toRoomResponse(r, occupied.get(r.id) ?? 0),
      ),
      total: result.total,
    };
  }

  async createRoom(dto: RoomDto): Promise<RoomResponseDto> {
    await this.assertHostelExists(dto.hostelId);
    const room = await this.prisma.room.create({
      data: {
        hostelId: dto.hostelId,
        floorLabel: dto.floorLabel,
        roomNumber: dto.roomNumber,
        capacity: dto.capacity,
        roomType: dto.roomType,
      } as unknown as Prisma.RoomUncheckedCreateInput,
    });
    return toRoomResponse(room, 0);
  }

  async updateRoom(id: string, dto: RoomDto): Promise<RoomResponseDto> {
    await this.findRoomOrThrow(id);
    await this.assertHostelExists(dto.hostelId);
    const room = await this.prisma.room.update({
      where: { id },
      data: {
        hostelId: dto.hostelId,
        floorLabel: dto.floorLabel,
        roomNumber: dto.roomNumber,
        capacity: dto.capacity,
        roomType: dto.roomType,
      },
    });
    return toRoomResponse(room, await this.activeOccupiedCount(id));
  }

  async removeRoom(id: string): Promise<void> {
    await this.findRoomOrThrow(id);
    const activeCount = await this.prisma.allocation.count({
      where: { roomId: id, status: 'active' },
    });
    if (activeCount > 0) {
      throw new ConflictException(
        `Room ${id} still has ${activeCount} active resident(s) — vacate them first`,
      );
    }
    await this.prisma.room.delete({ where: { id } });
  }

  /** `AllocationDesk`'s room picker — rooms in a hostel with at least one free bed, not paginated (mirrors `transport.md`'s `listAllVehicles`-style full-list endpoints). */
  async listAvailableRooms(hostelId: string): Promise<RoomResponseDto[]> {
    await this.assertHostelExists(hostelId);
    const rooms = await this.prisma.room.findMany({
      where: { hostelId },
      orderBy: { roomNumber: 'asc' },
    });
    const occupied = await this.occupiedBedCounts(rooms.map((r) => r.id));
    return rooms
      .map((r) => toRoomResponse(r, occupied.get(r.id) ?? 0))
      .filter((r) => r.occupiedBeds < r.capacity);
  }

  /** `AllocationDesk`'s bed grid for one room. */
  async getRoomOccupancy(roomId: string): Promise<RoomOccupancyDto> {
    const room = await this.findRoomOrThrow(roomId);
    const allocations = await this.prisma.allocation.findMany({
      where: { roomId, status: 'active' },
      orderBy: { bedNumber: 'asc' },
    });
    const students = await this.prisma.student.findMany({
      where: { id: { in: allocations.map((a) => a.studentId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(students.map((s) => [s.id, s.name]));

    const occupants: RoomOccupantDto[] = allocations.map((a) => ({
      allocationId: a.id,
      bedNumber: a.bedNumber,
      studentId: a.studentId,
      studentLabel: nameById.get(a.studentId) ?? '',
      allocatedAt: formatDateOnly(a.allocatedAt),
    }));

    return { roomId: room.id, capacity: room.capacity, occupants };
  }

  // ---------------------------------------------------------------------
  // Shared helpers — also used by `HostelAllocationsService`.
  // ---------------------------------------------------------------------

  async findHostelOrThrow(id: string): Promise<Hostel> {
    const hostel = await this.prisma.hostel.findUnique({ where: { id } });
    if (!hostel) {
      throw new NotFoundException(`Hostel ${id} not found`);
    }
    return hostel;
  }

  async findRoomOrThrow(id: string): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException(`Room ${id} not found`);
    }
    return room;
  }

  async activeOccupiedCount(roomId: string): Promise<number> {
    return this.prisma.allocation.count({
      where: { roomId, status: 'active' },
    });
  }

  private async assertHostelExists(hostelId: string): Promise<void> {
    const hostel = await this.prisma.hostel.findUnique({
      where: { id: hostelId },
    });
    if (!hostel) {
      throw new BadRequestException(`Hostel ${hostelId} not found`);
    }
  }

  private async occupiedBedCounts(
    roomIds: string[],
  ): Promise<Map<string, number>> {
    if (roomIds.length === 0) return new Map();
    const grouped = await this.prisma.allocation.groupBy({
      by: ['roomId'],
      where: { roomId: { in: roomIds }, status: 'active' },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.roomId, g._count._all]));
  }
}

function toHostelResponse(hostel: Hostel): HostelResponseDto {
  return {
    id: hostel.id,
    name: hostel.name,
    type: hostel.type,
    address: hostel.address,
    wardenName: hostel.wardenName,
    notes: hostel.notes,
  };
}

function toRoomResponse(room: Room, occupiedBeds: number): RoomResponseDto {
  return {
    id: room.id,
    hostelId: room.hostelId,
    floorLabel: room.floorLabel,
    roomNumber: room.roomNumber,
    capacity: room.capacity,
    roomType: room.roomType,
    occupiedBeds,
  };
}
