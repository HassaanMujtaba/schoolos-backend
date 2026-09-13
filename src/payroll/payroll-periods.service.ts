import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollPeriod, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { computePayslipBreakdown } from './payroll-calc';
import { PayrollPeriodDto } from './dto/payroll-period.dto';
import {
  PagedPayrollPeriodsDto,
  PayrollPeriodResponseDto,
} from './dto/payroll-response.dto';

/**
 * `GET/POST /payroll/periods`, `.../run`, `.../approve` — `frontend/src/features/payroll/api.ts`.
 * `payroll.read` gates every read, `payroll.run` create+run, `payroll.approve` the publish gate
 * (`router.tsx`'s own permission mapping — see `SalaryStructuresService`'s header comment for the
 * same source). `run`/`approve` are the `draft → generated → approved` state machine
 * (`PayrollPeriod`'s own schema doc comment).
 */
@Injectable()
export class PayrollPeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQueryDto): Promise<PagedPayrollPeriodsDto> {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.prisma.payrollPeriod.findMany({
          orderBy: { startDate: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.payrollPeriod.count(),
    );
    return {
      items: await Promise.all(result.items.map((p) => this.toResponse(p))),
      total: result.total,
    };
  }

  async get(id: string): Promise<PayrollPeriodResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async create(dto: PayrollPeriodDto): Promise<PayrollPeriodResponseDto> {
    const period = await this.prisma.payrollPeriod.create({
      data: {
        label: dto.label,
        startDate: parseDateOnly(dto.startDate),
        endDate: parseDateOnly(dto.endDate),
        status: 'draft',
      } as unknown as Prisma.PayrollPeriodUncheckedCreateInput,
    });
    return this.toResponse(period);
  }

  /**
   * `draft → generated` — one `Payslip` per active `Employee` that has a `SalaryStructure` on
   * file (an employee with no structure yet is silently skipped, not an error: this contract has
   * no per-employee "missing salary structure" warning surface, same trade-off `run`'s own commit
   * message would flag as a real, if minor, follow-up). Idempotent isn't the goal here — re-running
   * an already-`generated` period is rejected outright (`ConflictException` below); a correction
   * means editing salary structures and running a *new* period, matching `Payslip`'s own schema
   * doc comment ("there is no single-payslip edit endpoint").
   */
  async run(id: string): Promise<PayrollPeriodResponseDto> {
    const period = await this.findOrThrow(id);
    if (period.status !== 'draft') {
      throw new ConflictException(
        `Payroll period ${id} is already ${period.status} — only a draft period can be run`,
      );
    }

    const employees = await this.prisma.employee.findMany({
      where: { status: 'active' },
      include: { salaryStructure: true },
    });
    const eligible = employees
      .filter(
        (
          e,
        ): e is typeof e & {
          salaryStructure: NonNullable<(typeof e)['salaryStructure']>;
        } => e.salaryStructure !== null,
      )
      .map((e) => ({ employeeId: e.id, structure: e.salaryStructure }));

    const unpaidLeaveByEmployee = await this.sumUnpaidLeaveDays(
      eligible.map((e) => e.employeeId),
      period.startDate,
      period.endDate,
    );

    await this.prisma.$transaction(async (tx) => {
      for (const { employeeId, structure } of eligible) {
        const breakdown = computePayslipBreakdown({
          basicSalary: structure.basicSalary,
          housingAllowance: structure.housingAllowance,
          transportAllowance: structure.transportAllowance,
          otherAllowance: structure.otherAllowance,
          taxDeduction: structure.taxDeduction,
          loanDeduction: structure.loanDeduction,
          otherDeduction: structure.otherDeduction,
          unpaidLeaveDaysInPeriod: unpaidLeaveByEmployee.get(employeeId) ?? 0,
        });
        await tx.payslip.create({
          data: {
            periodId: id,
            employeeId,
            ...breakdown,
          } as unknown as Prisma.PayslipUncheckedCreateInput,
        });
      }
      await tx.payrollPeriod.update({
        where: { id },
        data: { status: 'generated' },
      });
    });

    return this.get(id);
  }

  async approve(id: string): Promise<PayrollPeriodResponseDto> {
    const period = await this.findOrThrow(id);
    if (period.status !== 'generated') {
      throw new ConflictException(
        `Payroll period ${id} is ${period.status} — only a generated period can be approved`,
      );
    }
    const updated = await this.prisma.payrollPeriod.update({
      where: { id },
      data: { status: 'approved' },
    });
    return this.toResponse(updated);
  }

  // ---------------------------------------------------------------------

  private async findOrThrow(id: string): Promise<PayrollPeriod> {
    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id },
    });
    if (!period) {
      throw new NotFoundException(`Payroll period ${id} not found`);
    }
    return period;
  }

  /** `absenceDeduction`'s real input (`payroll-calc.ts`'s own header comment) — approved `unpaid` leave days overlapping `[periodStart, periodEnd]`, per employee. */
  private async sumUnpaidLeaveDays(
    employeeIds: string[],
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Map<string, number>> {
    if (employeeIds.length === 0) return new Map();
    const leaves = await this.prisma.employeeLeaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        leaveType: 'unpaid',
        status: 'approved',
        startDate: { lte: periodEnd },
        endDate: { gte: periodStart },
      },
    });
    const totals = new Map<string, number>();
    for (const leave of leaves) {
      const overlapStart =
        leave.startDate > periodStart ? leave.startDate : periodStart;
      const overlapEnd = leave.endDate < periodEnd ? leave.endDate : periodEnd;
      const days =
        Math.round(
          (overlapEnd.getTime() - overlapStart.getTime()) /
            (24 * 60 * 60 * 1000),
        ) + 1;
      totals.set(
        leave.employeeId,
        (totals.get(leave.employeeId) ?? 0) + Math.max(0, days),
      );
    }
    return totals;
  }

  private async toResponse(
    period: PayrollPeriod,
  ): Promise<PayrollPeriodResponseDto> {
    const employeeCount = await this.prisma.payslip.count({
      where: { periodId: period.id },
    });
    return {
      id: period.id,
      label: period.label,
      startDate: formatDateOnly(period.startDate),
      endDate: formatDateOnly(period.endDate),
      status: period.status,
      employeeCount,
    };
  }
}
