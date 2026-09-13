import { Injectable, NotFoundException } from '@nestjs/common';
import { Announcement, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { AnnouncementDto } from './dto/announcement.dto';
import {
  AnnouncementResponseDto,
  PagedAnnouncementsDto,
} from './dto/announcement-response.dto';

/**
 * §28 broadcast announcements — `announcements.read` gates every read (`router.tsx`'s own
 * comment: "announcements carries the module doc's explicit announcements.read string"),
 * `announcements.create` gates create/update/delete — no separate update/delete permission exists
 * in the catalog.
 */
@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQueryDto): Promise<PagedAnnouncementsDto> {
    const where: Prisma.AnnouncementWhereInput = query.search
      ? { title: { contains: query.search, mode: 'insensitive' } }
      : {};
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.prisma.announcement.findMany({
          where,
          orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
          skip,
          take,
        }),
      () => this.prisma.announcement.count({ where }),
    );
    return { items: await this.toResponses(result.items), total: result.total };
  }

  async get(id: string): Promise<AnnouncementResponseDto> {
    const announcement = await this.findOrThrow(id);
    return (await this.toResponses([announcement]))[0];
  }

  async create(
    dto: AnnouncementDto,
    user: AuthenticatedUser,
  ): Promise<AnnouncementResponseDto> {
    const classIds = dto.audience === 'class' ? dto.classIds : [];
    await this.assertClassesExist(classIds);
    const announcement = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        classIds,
        pinned: dto.pinned,
        createdByUserId: user.id,
        createdByLabel: user.name,
      } as unknown as Prisma.AnnouncementUncheckedCreateInput,
    });
    return (await this.toResponses([announcement]))[0];
  }

  async update(
    id: string,
    dto: AnnouncementDto,
  ): Promise<AnnouncementResponseDto> {
    await this.findOrThrow(id);
    const classIds = dto.audience === 'class' ? dto.classIds : [];
    await this.assertClassesExist(classIds);
    const announcement = await this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        classIds,
        pinned: dto.pinned,
      },
    });
    return (await this.toResponses([announcement]))[0];
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.announcement.delete({ where: { id } });
  }

  private async findOrThrow(id: string): Promise<Announcement> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!announcement) {
      throw new NotFoundException(`Announcement ${id} not found`);
    }
    return announcement;
  }

  private async assertClassesExist(classIds: string[]): Promise<void> {
    if (classIds.length === 0) return;
    const found = await this.prisma.schoolClass.findMany({
      where: { id: { in: classIds } },
      select: { id: true },
    });
    const missing = classIds.filter((id) => !found.some((c) => c.id === id));
    if (missing.length > 0) {
      throw new NotFoundException(`Class(es) not found: ${missing.join(', ')}`);
    }
  }

  private async toResponses(
    announcements: Announcement[],
  ): Promise<AnnouncementResponseDto[]> {
    const classIds = [...new Set(announcements.flatMap((a) => a.classIds))];
    const classes = classIds.length
      ? await this.prisma.schoolClass.findMany({
          where: { id: { in: classIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(classes.map((c) => [c.id, c.name]));
    return announcements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      audience: a.audience,
      classIds: a.classIds,
      classLabels: a.classIds.map((id) => nameById.get(id) ?? ''),
      pinned: a.pinned,
      createdByLabel: a.createdByLabel,
      createdAt: a.createdAt.toISOString(),
    }));
  }
}
