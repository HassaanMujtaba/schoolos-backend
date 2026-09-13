import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { EmployeesService } from '../hr/employees.service';
import { SalaryStructureDto } from './dto/salary-structure.dto';
import { SalaryStructureResponseDto } from './dto/payroll-response.dto';

/**
 * `GET/PUT /payroll/salary-structures/:employeeId` — `frontend/src/features/payroll/api.ts`.
 * `payroll.read` gates the read (matches `EmployeeProfile`'s `canReadPayroll` tab-gate),
 * `payroll.run` the write (matches `EmployeeSalaryPanel`'s `canManage`, per that component's own
 * "Roles & permissions" note — salary config is treated as part of running payroll, not a
 * separate `payroll.manage` grant that isn't in this catalog).
 */
@Injectable()
export class SalaryStructuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  async get(employeeId: string): Promise<SalaryStructureResponseDto | null> {
    await this.employees.assertEmployeeExists(employeeId);
    const structure = await this.prisma.salaryStructure.findUnique({
      where: { employeeId },
    });
    return structure ? toResponse(structure) : null;
  }

  /** One row per employee (`SalaryStructure.employeeId` is `@unique`) — create on first save, update afterward. */
  async upsert(
    employeeId: string,
    dto: SalaryStructureDto,
  ): Promise<SalaryStructureResponseDto> {
    await this.employees.assertEmployeeExists(employeeId);
    const structure = await this.prisma.salaryStructure.upsert({
      where: { employeeId },
      create: {
        employeeId,
        ...dto,
      } as unknown as Prisma.SalaryStructureUncheckedCreateInput,
      update: { ...dto },
    });
    return toResponse(structure);
  }
}

function toResponse(structure: {
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  taxDeduction: number;
  loanDeduction: number;
  otherDeduction: number;
}): SalaryStructureResponseDto {
  return {
    basicSalary: structure.basicSalary,
    housingAllowance: structure.housingAllowance,
    transportAllowance: structure.transportAllowance,
    otherAllowance: structure.otherAllowance,
    taxDeduction: structure.taxDeduction,
    loanDeduction: structure.loanDeduction,
    otherDeduction: structure.otherDeduction,
  };
}
