import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { ListQueryDto } from '../../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../../common/pagination/paginate';
import { RouteDto } from './dto/route.dto';
import { PagedRoutesDto, RouteResponseDto } from './dto/route-response.dto';

const SORTABLE_FIELDS = ['name', 'createdAt'] as const;

const ROUTE_INCLUDE = {
  stops: { orderBy: { order: 'asc' } },
} satisfies Prisma.RouteInclude;

type RouteWithChildren = Prisma.RouteGetPayload<{
  include: typeof ROUTE_INCLUDE;
}>;

/**
 * `frontend/src/features/transport/api.ts`'s routes surface (`modules/transport.md` "Backend
 * dependencies"). `stops` are replaced wholesale on every create/update (delete-then-recreate
 * inside the same transaction, same convention as `VehiclesService.maintenanceRecords`), each
 * stamped with its submitted array index as `order` so display order survives the round trip.
 * `studentIds` referential integrity (against real `Student` rows) and `vehicleId`/
 * `feeStructureId` existence are enforced here, not by a DB foreign key for the former — same
 * trade-off `SubjectsService.assertClassesExist` already makes for `Subject.classIds`.
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async list(query: ListQueryDto): Promise<PagedRoutesDto> {
    const where: Prisma.RouteWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'name');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.route.findMany({
          where,
          include: ROUTE_INCLUDE,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.route.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<RouteResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: RouteDto): Promise<RouteResponseDto> {
    const tenantId = this.requireTenantId();
    const feeStructureId = await this.normalizeFeeStructureId(
      dto.feeStructureId,
    );
    await this.assertVehicleExists(dto.vehicleId);
    await this.assertStudentsExist(dto.studentIds);

    const route = await this.prisma.route.create({
      // Cast at this one boundary, same reasoning as `BranchesService.create`'s own doc comment.
      data: {
        name: dto.name,
        vehicleId: dto.vehicleId,
        driverName: dto.driverName,
        attendantName: dto.attendantName,
        feeStructureId,
        studentIds: dto.studentIds,
        stops: {
          create: dto.stops.map((s, index) => ({
            tenantId,
            name: s.name,
            time: s.time,
            order: index,
          })),
        },
      } as unknown as Prisma.RouteUncheckedCreateInput,
      include: ROUTE_INCLUDE,
    });
    return toResponse(route);
  }

  async update(id: string, dto: RouteDto): Promise<RouteResponseDto> {
    await this.findOrThrow(id);
    const tenantId = this.requireTenantId();
    const feeStructureId = await this.normalizeFeeStructureId(
      dto.feeStructureId,
    );
    await this.assertVehicleExists(dto.vehicleId);
    await this.assertStudentsExist(dto.studentIds);

    const route = await this.prisma.$transaction(async (tx) => {
      await tx.routeStop.deleteMany({ where: { routeId: id } });
      return tx.route.update({
        where: { id },
        data: {
          name: dto.name,
          vehicleId: dto.vehicleId,
          driverName: dto.driverName,
          attendantName: dto.attendantName,
          feeStructureId,
          studentIds: dto.studentIds,
          stops: {
            create: dto.stops.map((s, index) => ({
              tenantId,
              name: s.name,
              time: s.time,
              order: index,
            })),
          },
        },
        include: ROUTE_INCLUDE,
      });
    });

    return toResponse(route);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.route.delete({ where: { id } });
  }

  /** `''` (`RouteForm.tsx`'s "no fee structure" sentinel) means no linkage — `null` in the DB, not an empty-string FK. A non-empty value must resolve to a real, tenant-scoped `FeeStructure`. */
  private async normalizeFeeStructureId(
    feeStructureId: string,
  ): Promise<string | null> {
    if (feeStructureId.trim() === '') {
      return null;
    }
    const structure = await this.prisma.feeStructure.findUnique({
      where: { id: feeStructureId },
    });
    if (!structure) {
      throw new BadRequestException(
        `Fee structure ${feeStructureId} not found`,
      );
    }
    return feeStructureId;
  }

  private async assertVehicleExists(vehicleId: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle) {
      throw new BadRequestException(`Vehicle ${vehicleId} not found`);
    }
  }

  private async assertStudentsExist(studentIds: string[]): Promise<void> {
    if (studentIds.length === 0) return;
    const found = await this.prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true },
    });
    const missing = studentIds.filter((id) => !found.some((s) => s.id === id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Student(s) not found: ${missing.join(', ')}`,
      );
    }
  }

  /** See `BranchesService.requireTenantId`'s own doc comment — same reasoning, same limit. */
  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error('RoutesService called with no tenant in request context');
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<RouteWithChildren> {
    const route = await this.prisma.route.findUnique({
      where: { id },
      include: ROUTE_INCLUDE,
    });
    if (!route) {
      throw new NotFoundException(`Route ${id} not found`);
    }
    return route;
  }
}

function toResponse(route: RouteWithChildren): RouteResponseDto {
  return {
    id: route.id,
    name: route.name,
    vehicleId: route.vehicleId,
    driverName: route.driverName,
    attendantName: route.attendantName,
    feeStructureId: route.feeStructureId ?? '',
    stops: route.stops.map((s) => ({ id: s.id, name: s.name, time: s.time })),
    studentIds: route.studentIds,
  };
}
