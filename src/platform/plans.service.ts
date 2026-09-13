import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Plan } from '@prisma/client';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { lowerEnum, upperEnum } from './platform.mappers';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { CreatePlanDto, PlanDto, PlanResponseDto } from './dto/plan.dto';

/** `GET/POST/PATCH /platform/plans` — `modules/platform-console.md` "Subscriptions, Plans, Billing". Not tenant-scoped at all (a global catalog, like `Role`/`Permission`) — reads/writes through `PlatformPrismaService` for consistency with the rest of this module, though `TENANT_SCOPED_MODELS` never touches this table either way. */
@Injectable()
export class PlansService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditLog: PlatformAuditLogService,
  ) {}

  async list(): Promise<PlanResponseDto[]> {
    const plans = await this.platformPrisma.plan.findMany({
      orderBy: { priceMonthly: 'asc' },
    });
    return plans.map(toResponse);
  }

  async create(dto: CreatePlanDto): Promise<PlanResponseDto> {
    const tier = upperEnum<'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'>(dto.tier);
    try {
      const plan = await this.platformPrisma.plan.create({
        data: {
          tier,
          name: dto.name,
          priceMonthly: dto.priceMonthly,
          maxBranches: dto.maxBranches,
          maxStudents: dto.maxStudents,
          features: dto.features,
        },
      });
      await this.auditLog.record({ action: 'plan.created', target: plan.name });
      return toResponse(plan);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A plan for tier "${dto.tier}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: PlanDto): Promise<PlanResponseDto> {
    await this.findOrThrow(id);
    const plan = await this.platformPrisma.plan.update({
      where: { id },
      data: {
        name: dto.name,
        priceMonthly: dto.priceMonthly,
        maxBranches: dto.maxBranches,
        maxStudents: dto.maxStudents,
        features: dto.features,
      },
    });
    await this.auditLog.record({ action: 'plan.updated', target: plan.name });
    return toResponse(plan);
  }

  private async findOrThrow(id: string): Promise<Plan> {
    const plan = await this.platformPrisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`Plan ${id} not found`);
    }
    return plan;
  }
}

function toResponse(plan: Plan): PlanResponseDto {
  return {
    id: plan.id,
    tier: lowerEnum(plan.tier),
    name: plan.name,
    priceMonthly: plan.priceMonthly,
    maxBranches: plan.maxBranches,
    maxStudents: plan.maxStudents,
    features: plan.features,
  };
}
