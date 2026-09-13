import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeLeaveRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { resolveEmployeeId } from '../common/identity/resolve-me';
import {
  ListEmployeeLeaveQueryDto,
  ReviewEmployeeLeaveRequestDto,
  SubmitEmployeeLeaveRequestDto,
} from './dto/employee-leave.dto';
import {
  EmployeeLeaveResponseDto,
  LeaveBalanceResponseDto,
  PagedEmployeeLeaveDto,
} from './dto/employee-leave-response.dto';

// Same display order as `frontend/src/features/hr/schemas.ts`'s `LEAVE_TYPES` — `getLeaveBalances`
// returns all four every time (seeded at employee creation, `EmployeesService.create`), so this
// is purely a stable-order concern, not a filter.
const LEAVE_TYPE_ORDER = ['casual', 'sick', 'annual', 'unpaid'] as const;

/**
 * §14 Employee Leave — `frontend/src/features/hr/api.ts`'s `/leave/employee` surface. Mirrors
 * `attendance/leave.service.ts`'s student-leave shape closely (see that file's own header
 * comment): submission has no dedicated `@RequirePermission` at the route level either (module doc
 * "Roles & permissions": "any staff role (own leave requests ... via self-service views)") —
 * always resolved to the caller's own linked `Employee` record (`submit`'s own doc comment), never
 * a client-supplied id.
 */
@Injectable()
export class EmployeeLeaveService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(
    dto: SubmitEmployeeLeaveRequestDto,
    user: AuthenticatedUser,
  ): Promise<EmployeeLeaveResponseDto> {
    // Always the caller's own record — `SubmitEmployeeLeaveRequestDto` (`employeeLeaveRequestSchema`)
    // carries no `employeeId` field for an HR staff member to file on someone else's behalf (unlike
    // `LeaveService.submit`'s attendance-staff-on-behalf-of-a-child branch, which the wire contract
    // does support). A future on-behalf-of field would slot in here, resolving a caller-supplied
    // `employeeId` instead when the caller holds `hr.manage`.
    const employeeId = await resolveEmployeeId(this.prisma, 'me', user.id);

    const leave = await this.prisma.employeeLeaveRequest.create({
      data: {
        employeeId,
        leaveType: dto.leaveType,
        startDate: parseDateOnly(dto.startDate),
        endDate: parseDateOnly(dto.endDate),
        reason: dto.reason,
        status: 'pending',
      } as unknown as Prisma.EmployeeLeaveRequestUncheckedCreateInput,
    });
    return (await this.toResponses([leave]))[0];
  }

  /**
   * `GET /leave/employee` — `employeeId` present → a plain array (own history, `'me'` idiom
   * supported); absent → the paginated approval queue, optionally filtered by `status`. Same
   * dual-shape split as `LeaveService.list`.
   */
  async list(
    query: ListEmployeeLeaveQueryDto,
    currentUserId: string | null,
  ): Promise<EmployeeLeaveResponseDto[] | PagedEmployeeLeaveDto> {
    if (query.employeeId) {
      const employeeId = await resolveEmployeeId(
        this.prisma,
        query.employeeId,
        currentUserId,
      );
      const leaves = await this.prisma.employeeLeaveRequest.findMany({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
      });
      return this.toResponses(leaves);
    }

    const where: Prisma.EmployeeLeaveRequestWhereInput = query.status
      ? { status: query.status }
      : {};
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.prisma.employeeLeaveRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.employeeLeaveRequest.count({ where }),
    );
    return { items: await this.toResponses(result.items), total: result.total };
  }

  /**
   * `PATCH /leave/employee/:id` — gated by `leave.approve` at the route level (module doc
   * "Permission strings"). Approving increments the matching `LeaveBalance.used` by the request's
   * inclusive day span (`daysInclusive` below) — a real day-count, not re-derived from history on
   * every read, same "write it once at the state transition" choice `Invoice.paidAmount` makes.
   */
  async review(
    id: string,
    dto: ReviewEmployeeLeaveRequestDto,
    user: AuthenticatedUser,
  ): Promise<EmployeeLeaveResponseDto> {
    const existing = await this.findOrThrow(id);
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `Leave request ${id} has already been ${existing.status} — it can't be reviewed again`,
      );
    }

    const leave = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeLeaveRequest.update({
        where: { id },
        data: {
          status: dto.status,
          reviewNotes: dto.reviewNotes ?? null,
          reviewedByUserId: user.id,
          reviewedByLabel: user.name,
        },
      });
      if (dto.status === 'approved') {
        await tx.leaveBalance.updateMany({
          where: {
            employeeId: existing.employeeId,
            leaveType: existing.leaveType,
          },
          data: {
            used: {
              increment: daysInclusive(existing.startDate, existing.endDate),
            },
          },
        });
      }
      return updated;
    });
    return (await this.toResponses([leave]))[0];
  }

  async getBalances(
    rawEmployeeId: string,
    currentUserId: string | null,
  ): Promise<LeaveBalanceResponseDto[]> {
    const employeeId = await resolveEmployeeId(
      this.prisma,
      rawEmployeeId,
      currentUserId,
    );
    const balances = await this.prisma.leaveBalance.findMany({
      where: { employeeId },
    });
    const byType = new Map(balances.map((b) => [b.leaveType, b]));
    return LEAVE_TYPE_ORDER.map((leaveType) => ({
      leaveType,
      allotted: byType.get(leaveType)?.allotted ?? 0,
      used: byType.get(leaveType)?.used ?? 0,
    }));
  }

  // ---------------------------------------------------------------------

  private async findOrThrow(id: string): Promise<EmployeeLeaveRequest> {
    const leave = await this.prisma.employeeLeaveRequest.findUnique({
      where: { id },
    });
    if (!leave) {
      throw new NotFoundException(`Leave request ${id} not found`);
    }
    return leave;
  }

  private async toResponses(
    leaves: EmployeeLeaveRequest[],
  ): Promise<EmployeeLeaveResponseDto[]> {
    const employeeIds = [...new Set(leaves.map((l) => l.employeeId))];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(employees.map((e) => [e.id, e.name]));

    return leaves.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      employeeName: nameById.get(l.employeeId) ?? '',
      leaveType: l.leaveType,
      dateRange: {
        from: formatDateOnly(l.startDate),
        to: formatDateOnly(l.endDate),
      },
      reason: l.reason,
      status: l.status,
      reviewedBy: l.reviewedByLabel ?? null,
      reviewNotes: l.reviewNotes ?? null,
    }));
  }
}

/** Inclusive calendar-day span (`endDate - startDate + 1`) — weekends/holidays aren't excluded, same MVP-level simplification `fee-calc.ts`'s own header comment documents for its own rounding rules. */
function daysInclusive(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)) + 1);
}
