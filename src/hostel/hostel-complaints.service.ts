import { Complaint, Prisma } from '@prisma/client';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import {
  ComplaintDto,
  ComplaintResolutionDto,
  ComplaintStatus,
  ListComplaintsQueryDto,
} from './dto/complaint.dto';
import {
  ComplaintResponseDto,
  PagedComplaintsDto,
} from './dto/hostel-response.dto';

/**
 * `frontend/src/features/hostel/api.ts`'s complaints surface — `hostel.manage` gates both create
 * and resolve (the module doc's own catalog doesn't carve out a separate complaints permission).
 * `hostelName`/`roomLabel` are always resolved live from the real `Hostel`/`Room` rows; `roomId`/
 * `residentStudentId`/`residentLabel` may be `null` (a complaint about the mess hall has neither,
 * `schemas.ts`'s own comment) — `residentLabel` itself is client-supplied when present
 * (`schema.prisma`'s `Complaint` doc comment).
 */
@Injectable()
export class HostelComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListComplaintsQueryDto): Promise<PagedComplaintsDto> {
    const where: Prisma.ComplaintWhereInput = {
      ...(query.hostelId ? { hostelId: query.hostelId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { description: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.complaint.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.complaint.count({ where }),
    );

    return { items: await this.resolveMany(result.items), total: result.total };
  }

  async create(dto: ComplaintDto): Promise<ComplaintResponseDto> {
    await this.assertHostelExists(dto.hostelId);
    const roomId = dto.roomId ?? null;
    const residentStudentId = dto.residentStudentId ?? null;
    if (roomId) {
      await this.assertRoomBelongsToHostel(roomId, dto.hostelId);
    }
    if (residentStudentId) {
      await this.assertStudentExists(residentStudentId);
    }

    const complaint = await this.prisma.complaint.create({
      data: {
        hostelId: dto.hostelId,
        roomId,
        residentStudentId,
        residentLabel: residentStudentId ? (dto.residentLabel ?? '') : null,
        category: dto.category,
        description: dto.description,
        status: 'open',
      } as unknown as Prisma.ComplaintUncheckedCreateInput,
    });
    return (await this.resolveMany([complaint]))[0];
  }

  /** `resolvedAt` is set the first time `status` becomes `'resolved'` and cleared if it's moved off that status again — it always reflects the *current* resolved state, not a one-way flag. */
  async updateStatus(
    id: string,
    dto: ComplaintResolutionDto,
  ): Promise<ComplaintResponseDto> {
    const existing = await this.findOrThrow(id);
    const resolvedAt =
      dto.status === 'resolved' ? (existing.resolvedAt ?? new Date()) : null;

    const updated = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionNotes: dto.resolutionNotes,
        resolvedAt,
      },
    });
    return (await this.resolveMany([updated]))[0];
  }

  // ---------------------------------------------------------------------

  private async assertHostelExists(hostelId: string): Promise<void> {
    const hostel = await this.prisma.hostel.findUnique({
      where: { id: hostelId },
    });
    if (!hostel) {
      throw new BadRequestException(`Hostel ${hostelId} not found`);
    }
  }

  private async assertRoomBelongsToHostel(
    roomId: string,
    hostelId: string,
  ): Promise<void> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.hostelId !== hostelId) {
      throw new BadRequestException(
        `Room ${roomId} not found in hostel ${hostelId}`,
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

  private async findOrThrow(id: string): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
    });
    if (!complaint) {
      throw new NotFoundException(`Complaint ${id} not found`);
    }
    return complaint;
  }

  private async resolveMany(
    complaints: Complaint[],
  ): Promise<ComplaintResponseDto[]> {
    const hostelIds = [...new Set(complaints.map((c) => c.hostelId))];
    const roomIds = [
      ...new Set(
        complaints
          .map((c) => c.roomId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const [hostels, rooms] = await Promise.all([
      hostelIds.length
        ? this.prisma.hostel.findMany({
            where: { id: { in: hostelIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      roomIds.length
        ? this.prisma.room.findMany({
            where: { id: { in: roomIds } },
            select: { id: true, roomNumber: true },
          })
        : Promise.resolve([]),
    ]);

    const hostelNameById = new Map(hostels.map((h) => [h.id, h.name]));
    const roomNumberById = new Map(rooms.map((r) => [r.id, r.roomNumber]));

    return complaints.map((c): ComplaintResponseDto => ({
      id: c.id,
      hostelId: c.hostelId,
      hostelName: hostelNameById.get(c.hostelId) ?? '',
      roomId: c.roomId,
      roomLabel: c.roomId ? (roomNumberById.get(c.roomId) ?? null) : null,
      residentStudentId: c.residentStudentId,
      residentLabel: c.residentLabel,
      category: c.category,
      description: c.description,
      // `Complaint.status` is a plain DB `string` (see `schema.prisma`'s own doc comment on why
      // it isn't a Prisma enum) — every write path validates it against `COMPLAINT_STATUSES`
      // first (`ComplaintDto`/`ComplaintResolutionDto`'s `@IsIn`), so this cast reflects an
      // invariant already enforced, not a new one — same pattern `AssetsService` established.
      status: c.status as ComplaintStatus,
      resolutionNotes: c.resolutionNotes,
      createdAt: c.createdAt.toISOString(),
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    }));
  }
}
