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
import { formatDateOnly, parseDateOnly } from '../../common/dates/date-only';
import { AssetDto, AssetStatus } from './dto/asset.dto';
import {
  AssetMaintenanceRecordResponseDto,
  AssetResponseDto,
  PagedAssetsDto,
} from './dto/asset-response.dto';

const SORTABLE_FIELDS = [
  'assetCode',
  'name',
  'category',
  'status',
  'purchaseDate',
  'createdAt',
] as const;

const ASSET_INCLUDE = {
  maintenanceRecords: { orderBy: { date: 'desc' } },
} satisfies Prisma.AssetInclude;

type AssetWithChildren = Prisma.AssetGetPayload<{
  include: typeof ASSET_INCLUDE;
}>;

/**
 * `frontend/src/features/inventory/api.ts`'s assets surface (`modules/inventory.md` "Backend
 * dependencies") — served at the top-level `/assets` prefix, not `/inventory/assets` (matching
 * `api.ts`'s own routes exactly). `maintenanceRecords` are replaced wholesale on every create/
 * update (delete-then-recreate in the same transaction), same convention `VehiclesService`
 * already set. Depreciation is not computed here at all — resolved client-side, straight-line,
 * per `inventory.md`'s own resolved "Open questions" note.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async list(query: ListQueryDto): Promise<PagedAssetsDto> {
    const where: Prisma.AssetWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { assetCode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const sortBy = resolveSortField(query.sortBy, SORTABLE_FIELDS, 'assetCode');
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.asset.findMany({
          where,
          include: ASSET_INCLUDE,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
        }),
      () => this.prisma.asset.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<AssetResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async create(dto: AssetDto): Promise<AssetResponseDto> {
    this.assertDisposalDateIfDisposed(dto);
    const tenantId = this.requireTenantId();
    const asset = await this.prisma.asset.create({
      // Cast at this one boundary, same reasoning as `BranchesService.create`'s own doc comment —
      // the nested `maintenanceRecords.create` payload needs an explicit `tenantId` stamp
      // (`PrismaService`'s tenant-scoping extension can't see into a nested write).
      data: {
        assetCode: dto.assetCode,
        name: dto.name,
        category: dto.category,
        status: dto.status,
        purchaseDate: parseDateOnly(dto.purchaseDate),
        purchaseCost: dto.purchaseCost,
        usefulLifeYears: dto.usefulLifeYears,
        location: dto.location,
        assignedTo: dto.assignedTo,
        warrantyExpiryDate: dto.warrantyExpiryDate
          ? parseDateOnly(dto.warrantyExpiryDate)
          : null,
        disposalDate: dto.disposalDate ? parseDateOnly(dto.disposalDate) : null,
        disposalReason: dto.disposalReason,
        disposalValue: dto.disposalValue ?? null,
        maintenanceRecords: {
          create: dto.maintenanceRecords.map((m) => ({
            tenantId,
            date: parseDateOnly(m.date),
            description: m.description,
            cost: m.cost ?? null,
          })),
        },
      } as unknown as Prisma.AssetUncheckedCreateInput,
      include: ASSET_INCLUDE,
    });
    return toResponse(asset);
  }

  async update(id: string, dto: AssetDto): Promise<AssetResponseDto> {
    this.assertDisposalDateIfDisposed(dto);
    await this.findOrThrow(id);
    const tenantId = this.requireTenantId();

    const asset = await this.prisma.$transaction(async (tx) => {
      await tx.assetMaintenanceRecord.deleteMany({ where: { assetId: id } });
      return tx.asset.update({
        where: { id },
        data: {
          assetCode: dto.assetCode,
          name: dto.name,
          category: dto.category,
          status: dto.status,
          purchaseDate: parseDateOnly(dto.purchaseDate),
          purchaseCost: dto.purchaseCost,
          usefulLifeYears: dto.usefulLifeYears,
          location: dto.location,
          assignedTo: dto.assignedTo,
          warrantyExpiryDate: dto.warrantyExpiryDate
            ? parseDateOnly(dto.warrantyExpiryDate)
            : null,
          disposalDate: dto.disposalDate
            ? parseDateOnly(dto.disposalDate)
            : null,
          disposalReason: dto.disposalReason,
          disposalValue: dto.disposalValue ?? null,
          maintenanceRecords: {
            create: dto.maintenanceRecords.map((m) => ({
              tenantId,
              date: parseDateOnly(m.date),
              description: m.description,
              cost: m.cost ?? null,
            })),
          },
        },
        include: ASSET_INCLUDE,
      });
    });

    return toResponse(asset);
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    await this.prisma.asset.delete({ where: { id } });
  }

  /** `assetSchema`'s own `.refine` (`schemas.ts`) — enforced here rather than a DTO decorator, same "cross-field business rule lives in the service" convention as `AdmissionsService.assertStageTransitionAllowed`. */
  private assertDisposalDateIfDisposed(dto: AssetDto): void {
    if (dto.status === 'disposed' && dto.disposalDate.trim() === '') {
      throw new BadRequestException(
        'Disposal date is required once an asset is marked disposed',
      );
    }
  }

  /** See `BranchesService.requireTenantId`'s own doc comment — same reasoning, same limit. */
  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error('AssetsService called with no tenant in request context');
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<AssetWithChildren> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: ASSET_INCLUDE,
    });
    if (!asset) {
      throw new NotFoundException(`Asset ${id} not found`);
    }
    return asset;
  }
}

function toResponse(asset: AssetWithChildren): AssetResponseDto {
  return {
    id: asset.id,
    assetCode: asset.assetCode,
    name: asset.name,
    category: asset.category,
    // `Asset.status` is a plain DB `string` (see `schema.prisma`'s own doc comment on why it
    // isn't a Prisma enum) — every write path validates it against `ASSET_STATUSES` first
    // (`AssetDto`'s `@IsIn`), so this cast reflects an invariant already enforced, not a new one.
    status: asset.status as AssetStatus,
    purchaseDate: formatDateOnly(asset.purchaseDate),
    purchaseCost: asset.purchaseCost,
    usefulLifeYears: asset.usefulLifeYears,
    location: asset.location,
    assignedTo: asset.assignedTo,
    warrantyExpiryDate: asset.warrantyExpiryDate
      ? formatDateOnly(asset.warrantyExpiryDate)
      : '',
    maintenanceRecords: asset.maintenanceRecords.map(
      (m): AssetMaintenanceRecordResponseDto => ({
        id: m.id,
        date: formatDateOnly(m.date),
        description: m.description,
        cost: m.cost ?? undefined,
      }),
    ),
    disposalDate: asset.disposalDate ? formatDateOnly(asset.disposalDate) : '',
    disposalReason: asset.disposalReason,
    disposalValue: asset.disposalValue ?? undefined,
  };
}
