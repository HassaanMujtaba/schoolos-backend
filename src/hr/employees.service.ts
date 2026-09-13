import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Employee, EmployeeLeaveType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import {
  paginate,
  resolveSortField,
  toSkipTake,
} from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { EmployeeDto } from './dto/employee.dto';
import { LifecycleActionDto } from './dto/lifecycle-action.dto';
import {
  EmployeeResponseDto,
  PagedEmployeesDto,
} from './dto/employee-response.dto';

type EmployeeWithHistory = Prisma.EmployeeGetPayload<{
  include: { lifecycleEvents: true };
}>;

const EMPLOYEE_SORTABLE_FIELDS = [
  'name',
  'department',
  'designation',
  'dateOfJoining',
  'createdAt',
] as const;

/**
 * Fixed default allotment per leave type, seeded onto every new employee's `LeaveBalance` rows
 * (module doc "Leave types are a fixed four-value list, not a configurable CRUD list" — the
 * allotments are just as fixed, pending a real per-role/per-tenant policy). `unpaid` gets `0`: it
 * isn't a capped allowance, just a category `EmployeeLeaveService.review` still tracks `used`
 * against for history/reporting.
 */
const DEFAULT_LEAVE_ALLOTMENTS: Record<EmployeeLeaveType, number> = {
  casual: 12,
  sick: 10,
  annual: 15,
  unpaid: 0,
};

/**
 * `frontend/src/features/hr/api.ts`'s employee directory + lifecycle surface
 * (`modules/hr-payroll.md` "Backend dependencies"). `hr.manage` gates every mutation, `hr.read`
 * every read, matching the module doc's own permission catalog. `status` is never a direct field
 * edit — it only moves through `recordLifecycleAction` below, same "no direct write" precedent
 * `AdmissionApplication.stage` already set.
 */
@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQueryDto): Promise<PagedEmployeesDto> {
    const where: Prisma.EmployeeWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { employeeId: { contains: query.search, mode: 'insensitive' } },
            { department: { contains: query.search, mode: 'insensitive' } },
            { designation: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const sortBy = resolveSortField(
      query.sortBy,
      EMPLOYEE_SORTABLE_FIELDS,
      'name',
    );
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.employee.findMany({
          where,
          orderBy: { [sortBy]: query.sortDir ?? 'asc' },
          skip,
          take,
          include: { lifecycleEvents: { orderBy: { recordedAt: 'desc' } } },
        }),
      () => this.prisma.employee.count({ where }),
    );

    return { items: result.items.map(toEmployeeResponse), total: result.total };
  }

  async get(id: string): Promise<EmployeeResponseDto> {
    const employee = await this.findOrThrow(id);
    return toEmployeeResponse(employee);
  }

  /** Also seeds the fixed four `LeaveBalance` rows (`DEFAULT_LEAVE_ALLOTMENTS` above) in the same transaction. */
  async create(dto: EmployeeDto): Promise<EmployeeResponseDto> {
    if (dto.teacherId) {
      await this.assertTeacherExists(dto.teacherId);
    }
    const employee = await this.wrapUniqueViolation(dto.employeeId, () =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.employee.create({
          data: {
            name: dto.name,
            email: dto.email,
            phone: dto.phone,
            employeeId: dto.employeeId,
            department: dto.department,
            designation: dto.designation,
            employmentType: dto.employmentType,
            dateOfJoining: parseDateOnly(dto.dateOfJoining),
            status: 'active',
            teacherId: dto.teacherId ?? null,
          } as unknown as Prisma.EmployeeUncheckedCreateInput,
        });
        await tx.leaveBalance.createMany({
          data: Object.entries(DEFAULT_LEAVE_ALLOTMENTS).map(
            ([leaveType, allotted]) => ({
              employeeId: created.id,
              leaveType: leaveType as EmployeeLeaveType,
              allotted,
            }),
          ) as unknown as Prisma.LeaveBalanceUncheckedCreateInput[],
        });
        return created;
      }),
    );
    return toEmployeeResponse({ ...employee, lifecycleEvents: [] });
  }

  async update(id: string, dto: EmployeeDto): Promise<EmployeeResponseDto> {
    await this.findOrThrow(id);
    if (dto.teacherId) {
      await this.assertTeacherExists(dto.teacherId);
    }
    const employee = await this.wrapUniqueViolation(dto.employeeId, () =>
      this.prisma.employee.update({
        where: { id },
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          employeeId: dto.employeeId,
          department: dto.department,
          designation: dto.designation,
          employmentType: dto.employmentType,
          dateOfJoining: parseDateOnly(dto.dateOfJoining),
          teacherId: dto.teacherId ?? null,
        },
      }),
    );
    return this.get(employee.id);
  }

  /**
   * `POST /hr/transfers`, `/hr/resignations`, `/hr/terminations` — one shared implementation per
   * `LifecycleActionDto`'s own doc comment: appends an `EmployeeLifecycleEvent` row and flips
   * `Employee.status`/`department`/`designation` in the same transaction. Terminal states
   * (`resigned`/`terminated`) reject any further lifecycle action — same "no further action" call
   * `AllocationStatus.vacated` already makes for a closed-out hostel allocation.
   */
  async recordLifecycleAction(
    type: 'transfer' | 'resignation' | 'termination',
    dto: LifecycleActionDto,
  ): Promise<EmployeeResponseDto> {
    const employee = await this.findOrThrow(dto.employeeId);
    if (employee.status === 'resigned' || employee.status === 'terminated') {
      throw new ConflictException(
        `Employee ${dto.employeeId} has already left (status: ${employee.status}) — no further lifecycle action can be recorded`,
      );
    }
    if (type === 'transfer' && (!dto.newDepartment || !dto.newDesignation)) {
      throw new BadRequestException(
        'newDepartment and newDesignation are required for a transfer',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeLifecycleEvent.create({
        data: {
          employeeId: dto.employeeId,
          type,
          effectiveDate: parseDateOnly(dto.effectiveDate),
          reason: dto.reason,
          newDepartment: type === 'transfer' ? dto.newDepartment : null,
          newDesignation: type === 'transfer' ? dto.newDesignation : null,
        } as unknown as Prisma.EmployeeLifecycleEventUncheckedCreateInput,
      });

      const nextStatus: Employee['status'] | undefined =
        type === 'resignation'
          ? 'resigned'
          : type === 'termination'
            ? 'terminated'
            : undefined;
      await tx.employee.update({
        where: { id: dto.employeeId },
        data: {
          ...(type === 'transfer'
            ? { department: dto.newDepartment, designation: dto.newDesignation }
            : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
        },
      });
    });

    return this.get(dto.employeeId);
  }

  // ---------------------------------------------------------------------
  // Shared helpers — also used by `PayrollModule`'s services.
  // ---------------------------------------------------------------------

  async findOrThrow(id: string): Promise<EmployeeWithHistory> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { lifecycleEvents: { orderBy: { recordedAt: 'desc' } } },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${id} not found`);
    }
    return employee;
  }

  /** Used by `PayrollModule`'s services to validate an `employeeId` path param without pulling in the full lifecycle-history include. */
  async assertEmployeeExists(id: string): Promise<Employee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new BadRequestException(`Employee ${id} not found`);
    }
    return employee;
  }

  private async assertTeacherExists(teacherId: string): Promise<void> {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: teacherId },
    });
    if (!teacher) {
      throw new BadRequestException(`Teacher ${teacherId} not found`);
    }
  }

  private async wrapUniqueViolation<T>(
    employeeCode: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Employee ID "${employeeCode}" is already in use`,
        );
      }
      throw error;
    }
  }
}

function toEmployeeResponse(
  employee: EmployeeWithHistory,
): EmployeeResponseDto {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    employeeId: employee.employeeId,
    department: employee.department,
    designation: employee.designation,
    employmentType: employee.employmentType,
    dateOfJoining: formatDateOnly(employee.dateOfJoining),
    status: employee.status,
    lifecycleHistory: employee.lifecycleEvents.map((event) => ({
      id: event.id,
      type: event.type,
      effectiveDate: formatDateOnly(event.effectiveDate),
      reason: event.reason,
      ...(event.newDepartment ? { newDepartment: event.newDepartment } : {}),
      ...(event.newDesignation ? { newDesignation: event.newDesignation } : {}),
      recordedAt: event.recordedAt.toISOString(),
    })),
  };
}
