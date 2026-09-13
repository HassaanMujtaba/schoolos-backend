import { Injectable, NotFoundException } from '@nestjs/common';
import { Payslip, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { resolveEmployeeId } from '../common/identity/resolve-me';
import { ListPayslipsQueryDto } from './dto/payroll-period.dto';
import {
  PagedPayslipsDto,
  PayslipResponseDto,
} from './dto/payroll-response.dto';

/**
 * `GET /payroll/payslips`, `GET /payroll/payslips/:id` — `frontend/src/features/payroll/api.ts`.
 * Deliberately ungated by any `@RequirePermission` (`router.tsx`'s own comment: "this is the one
 * payroll route that isn't gated on `payroll.read`") — the self-service "My payslips" list
 * (`employeeId=me`) has to work for any authenticated staff member. To keep that safe without a
 * route-level gate, an `employeeId` filter always restricts to `approved` periods only (the
 * "publish gate" `PayrollPeriod`'s own schema doc comment describes); a bare `periodId` query with
 * no `employeeId` (the admin queue, reached only through the `payroll.read`-gated period detail
 * page client-side) shows every status so `PayrollRunPanel` can display freshly `generated`,
 * not-yet-approved payslips.
 */
@Injectable()
export class PayslipsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListPayslipsQueryDto,
    currentUserId: string | null,
  ): Promise<PagedPayslipsDto> {
    const employeeId = query.employeeId
      ? await resolveEmployeeId(this.prisma, query.employeeId, currentUserId)
      : undefined;

    const where: Prisma.PayslipWhereInput = {
      ...(query.periodId ? { periodId: query.periodId } : {}),
      ...(employeeId ? { employeeId, period: { status: 'approved' } } : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.prisma.payslip.findMany({
          where,
          orderBy: { generatedAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.payslip.count({ where }),
    );
    return { items: await this.toResponses(result.items), total: result.total };
  }

  async get(id: string): Promise<PayslipResponseDto> {
    const payslip = await this.prisma.payslip.findUnique({ where: { id } });
    if (!payslip) {
      throw new NotFoundException(`Payslip ${id} not found`);
    }
    return (await this.toResponses([payslip]))[0];
  }

  private async toResponses(
    payslips: Payslip[],
  ): Promise<PayslipResponseDto[]> {
    const periodIds = [...new Set(payslips.map((p) => p.periodId))];
    const employeeIds = [...new Set(payslips.map((p) => p.employeeId))];

    const [periods, employees] = await Promise.all([
      periodIds.length
        ? this.prisma.payrollPeriod.findMany({
            where: { id: { in: periodIds } },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true, name: true, designation: true },
          })
        : Promise.resolve([]),
    ]);
    const periodById = new Map(periods.map((p) => [p.id, p]));
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    return payslips.map((p) => ({
      id: p.id,
      periodId: p.periodId,
      periodLabel: periodById.get(p.periodId)?.label ?? '',
      employeeId: p.employeeId,
      employeeName: employeeById.get(p.employeeId)?.name ?? '',
      employeeDesignation: employeeById.get(p.employeeId)?.designation ?? '',
      breakdown: {
        basicSalary: p.basicSalary,
        allowances: p.allowances,
        overtime: p.overtime,
        bonus: p.bonus,
        tax: p.tax,
        deductions: p.deductions,
        absenceDeduction: p.absenceDeduction,
        loanDeduction: p.loanDeduction,
        netPay: p.netPay,
      },
      generatedAt: p.generatedAt.toISOString(),
    }));
  }
}
