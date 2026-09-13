import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Allocation, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { HostelStructureService } from './hostel-structure.service';
import {
  AllocateDto,
  ListAllocationsQueryDto,
  ReassignDto,
} from './dto/allocation.dto';
import {
  AllocationResponseDto,
  PagedAllocationsDto,
} from './dto/hostel-response.dto';

/**
 * `frontend/src/features/hostel/api.ts`'s allocation surface — `hostel.allocate` gates every
 * mutation here, separate from `hostel.manage` (the module doc's own reasoning: a front-desk
 * Warden may run allocation without rights to edit the room/hostel structure itself). One
 * `Allocation` row per continuous stay (`schema.prisma`'s own doc comment) — `reassign` updates
 * `roomId`/`bedNumber` in place, `vacate` closes the row out rather than deleting it.
 */
@Injectable()
export class HostelAllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structure: HostelStructureService,
  ) {}

  async list(query: ListAllocationsQueryDto): Promise<PagedAllocationsDto> {
    const where: Prisma.AllocationWhereInput = {
      ...(query.hostelId ? { room: { hostelId: query.hostelId } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.allocation.findMany({
          where,
          orderBy: { allocatedAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.allocation.count({ where }),
    );

    return { items: await this.resolveMany(result.items), total: result.total };
  }

  /**
   * `hostel.md`'s "Requirements: room allocation" — validates the room/bed pair against the
   * room's real `capacity`, rejects a bed another active allocation already holds, and rejects a
   * student who already has an active allocation elsewhere (a resident holding two simultaneous
   * beds isn't a real state; move them via vacate + re-allocate instead, matching this module
   * doc's own resolved call on same-room reassignment not being supported either).
   */
  async allocate(dto: AllocateDto): Promise<AllocationResponseDto> {
    await this.assertStudentExists(dto.studentId);
    const room = await this.structure.findRoomOrThrow(dto.roomId);
    this.assertBedInRange(dto.bedNumber, room.capacity);
    await this.assertBedFree(dto.roomId, dto.bedNumber);
    await this.assertStudentNotAlreadyResident(dto.studentId);

    const allocation = await this.prisma.allocation.create({
      data: {
        studentId: dto.studentId,
        roomId: dto.roomId,
        bedNumber: dto.bedNumber,
        status: 'active',
      } as unknown as Prisma.AllocationUncheckedCreateInput,
    });
    return this.resolveOne(allocation);
  }

  async reassign(id: string, dto: ReassignDto): Promise<AllocationResponseDto> {
    await this.findActiveOrThrow(id);
    const room = await this.structure.findRoomOrThrow(dto.roomId);
    this.assertBedInRange(dto.bedNumber, room.capacity);
    await this.assertBedFree(dto.roomId, dto.bedNumber, id);

    const updated = await this.prisma.allocation.update({
      where: { id },
      data: { roomId: dto.roomId, bedNumber: dto.bedNumber },
    });
    return this.resolveOne(updated);
  }

  async vacate(id: string): Promise<AllocationResponseDto> {
    const allocation = await this.findActiveOrThrow(id);
    const updated = await this.prisma.allocation.update({
      where: { id: allocation.id },
      data: {
        status: 'vacated',
        vacatedAt: parseDateOnly(formatDateOnly(new Date())),
      },
    });
    return this.resolveOne(updated);
  }

  // ---------------------------------------------------------------------

  private assertBedInRange(bedNumber: number, capacity: number): void {
    if (bedNumber < 1 || bedNumber > capacity) {
      throw new BadRequestException(
        `Bed ${bedNumber} is out of range for a room with ${capacity} bed(s)`,
      );
    }
  }

  private async assertBedFree(
    roomId: string,
    bedNumber: number,
    excludeAllocationId?: string,
  ): Promise<void> {
    const clash = await this.prisma.allocation.findFirst({
      where: {
        roomId,
        bedNumber,
        status: 'active',
        ...(excludeAllocationId ? { id: { not: excludeAllocationId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictException(`Bed ${bedNumber} is already occupied`);
    }
  }

  private async assertStudentNotAlreadyResident(
    studentId: string,
  ): Promise<void> {
    const existing = await this.prisma.allocation.findFirst({
      where: { studentId, status: 'active' },
    });
    if (existing) {
      throw new ConflictException(
        `Student ${studentId} already has an active hostel allocation — vacate it first`,
      );
    }
  }

  private async assertStudentExists(studentId: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new BadRequestException(`Student ${studentId} not found`);
    }
  }

  private async findActiveOrThrow(id: string): Promise<Allocation> {
    const allocation = await this.prisma.allocation.findUnique({
      where: { id },
    });
    if (!allocation) {
      throw new NotFoundException(`Allocation ${id} not found`);
    }
    if (allocation.status !== 'active') {
      throw new ConflictException(`Allocation ${id} is already vacated`);
    }
    return allocation;
  }

  private async resolveOne(
    allocation: Allocation,
  ): Promise<AllocationResponseDto> {
    const [resolved] = await this.resolveMany([allocation]);
    return resolved;
  }

  /** Batch-resolves `studentLabel`/`hostelId`/`hostelName`/`roomLabel` for a page of allocations — never client-supplied, always the real `Student`/`Room`/`Hostel` rows (`schema.prisma`'s own doc comment). */
  private async resolveMany(
    allocations: Allocation[],
  ): Promise<AllocationResponseDto[]> {
    const roomIds = [...new Set(allocations.map((a) => a.roomId))];
    const studentIds = [...new Set(allocations.map((a) => a.studentId))];

    const [rooms, students] = await Promise.all([
      roomIds.length
        ? this.prisma.room.findMany({
            where: { id: { in: roomIds } },
            include: { hostel: true },
          })
        : Promise.resolve([]),
      studentIds.length
        ? this.prisma.student.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const studentNameById = new Map(students.map((s) => [s.id, s.name]));

    return allocations.map((a): AllocationResponseDto => {
      const room = roomById.get(a.roomId);
      return {
        id: a.id,
        studentId: a.studentId,
        studentLabel: studentNameById.get(a.studentId) ?? '',
        hostelId: room?.hostelId ?? '',
        hostelName: room?.hostel.name ?? '',
        roomId: a.roomId,
        roomLabel: room?.roomNumber ?? '',
        bedNumber: a.bedNumber,
        allocatedAt: formatDateOnly(a.allocatedAt),
        vacatedAt: a.vacatedAt ? formatDateOnly(a.vacatedAt) : null,
        status: a.status,
      };
    });
  }
}
