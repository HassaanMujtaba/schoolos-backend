import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { StorageService } from '../../common/storage/storage.service';
import { ListQueryDto } from '../../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../../common/dates/date-only';
import { VehicleDto } from './dto/vehicle.dto';
import {
  MaintenanceRecordResponseDto,
  PagedVehiclesDto,
  VehicleDocumentDto,
  VehicleResponseDto,
} from './dto/vehicle-response.dto';

const SORTABLE_FIELDS = [
  'registrationNumber',
  'type',
  'status',
  'createdAt',
] as const;

const VEHICLE_INCLUDE = {
  maintenanceRecords: { orderBy: { date: 'desc' } },
} satisfies Prisma.VehicleInclude;

type VehicleWithChildren = Prisma.VehicleGetPayload<{
  include: typeof VEHICLE_INCLUDE;
}>;

/**
 * `frontend/src/features/transport/api.ts`'s vehicles surface (`modules/transport.md` "Backend
 * dependencies"). `maintenanceRecords` are replaced wholesale on every create/update
 * (delete-then-recreate inside the same transaction), matching the semantics of a
 * `useFieldArray`-submitted full list — same convention `BranchesService`'s buildings/departments
 * already set. `documents` resolves the same real way `StudentsService` already resolves
 * `Student.documents` (category + ownerId) — see `schema.prisma`'s `DocumentCategory.vehicle` doc
 * comment for why nothing populates it yet.
 */
@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly storage: StorageService,
  ) {}

  async list(query: ListQueryDto): Promise<PagedVehiclesDto> {
    const where: Prisma.VehicleWhereInput = query.search
      ? {
          OR: [
            {
              registrationNumber: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            { driverName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const sortBy = resolveSortField(
      query.sortBy,
      SORTABLE_FIELDS,
      'registrationNumber',
    );
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.vehicle.findMany({
          where,
          include: VEHICLE_INCLUDE,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.vehicle.count({ where }),
    );

    return {
      items: await Promise.all(result.items.map((v) => this.toResponse(v))),
      total: result.total,
    };
  }

  async get(id: string): Promise<VehicleResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async create(dto: VehicleDto): Promise<VehicleResponseDto> {
    const tenantId = this.requireTenantId();
    const vehicle = await this.prisma.vehicle.create({
      // Cast at this one boundary, same reasoning as `BranchesService.create`'s own doc comment —
      // the nested `maintenanceRecords.create` payload needs an explicit `tenantId` stamp
      // (`PrismaService`'s tenant-scoping extension can't see into a nested write).
      data: {
        registrationNumber: dto.registrationNumber,
        type: dto.type,
        capacity: dto.capacity,
        status: dto.status,
        driverName: dto.driverName,
        driverPhone: dto.driverPhone,
        insuranceProvider: dto.insuranceProvider,
        insuranceExpiryDate: dto.insuranceExpiryDate
          ? parseDateOnly(dto.insuranceExpiryDate)
          : null,
        maintenanceRecords: {
          create: dto.maintenanceRecords.map((m) => ({
            tenantId,
            date: parseDateOnly(m.date),
            description: m.description,
            cost: m.cost ?? null,
          })),
        },
      } as unknown as Prisma.VehicleUncheckedCreateInput,
      include: VEHICLE_INCLUDE,
    });
    return this.toResponse(vehicle);
  }

  async update(id: string, dto: VehicleDto): Promise<VehicleResponseDto> {
    await this.findOrThrow(id);
    const tenantId = this.requireTenantId();

    const vehicle = await this.prisma.$transaction(async (tx) => {
      await tx.vehicleMaintenanceRecord.deleteMany({
        where: { vehicleId: id },
      });
      return tx.vehicle.update({
        where: { id },
        data: {
          registrationNumber: dto.registrationNumber,
          type: dto.type,
          capacity: dto.capacity,
          status: dto.status,
          driverName: dto.driverName,
          driverPhone: dto.driverPhone,
          insuranceProvider: dto.insuranceProvider,
          insuranceExpiryDate: dto.insuranceExpiryDate
            ? parseDateOnly(dto.insuranceExpiryDate)
            : null,
          maintenanceRecords: {
            create: dto.maintenanceRecords.map((m) => ({
              tenantId,
              date: parseDateOnly(m.date),
              description: m.description,
              cost: m.cost ?? null,
            })),
          },
        },
        include: VEHICLE_INCLUDE,
      });
    });

    return this.toResponse(vehicle);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    const routeCount = await this.prisma.route.count({
      where: { vehicleId: id },
    });
    if (routeCount > 0) {
      throw new ConflictException(
        `Vehicle ${id} is assigned to ${routeCount} route(s) and cannot be deleted`,
      );
    }
    await this.prisma.vehicle.delete({ where: { id } });
  }

  /** See `BranchesService.requireTenantId`'s own doc comment — same reasoning, same limit. */
  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'VehiclesService called with no tenant in request context',
      );
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<VehicleWithChildren> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: VEHICLE_INCLUDE,
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${id} not found`);
    }
    return vehicle;
  }

  private async toResponse(
    vehicle: VehicleWithChildren,
  ): Promise<VehicleResponseDto> {
    const documents = await this.prisma.document.findMany({
      where: { category: 'vehicle', ownerId: vehicle.id },
      include: {
        versions: { orderBy: { version: 'desc' as const }, take: 1 },
      },
    });

    return {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      type: vehicle.type,
      capacity: vehicle.capacity,
      status: vehicle.status,
      driverName: vehicle.driverName,
      driverPhone: vehicle.driverPhone,
      insuranceProvider: vehicle.insuranceProvider,
      insuranceExpiryDate: vehicle.insuranceExpiryDate
        ? formatDateOnly(vehicle.insuranceExpiryDate)
        : '',
      maintenanceRecords: vehicle.maintenanceRecords.map(
        (m): MaintenanceRecordResponseDto => ({
          id: m.id,
          date: formatDateOnly(m.date),
          description: m.description,
          cost: m.cost ?? undefined,
        }),
      ),
      documents: await Promise.all(
        documents.map(async (d): Promise<VehicleDocumentDto> => ({
          id: d.id,
          name: d.versions[0].fileName,
          url: await this.storage.getSignedDownloadUrl(
            d.versions[0].storageKey,
          ),
          uploadedAt: d.versions[0].createdAt.toISOString(),
        })),
      ),
    };
  }
}
