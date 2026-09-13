import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './salary-structures.service';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayslipsController } from './payslips.controller';
import { PayslipsService } from './payslips.service';

/**
 * PRD §20 Payroll (Phase 7.6, `../implementation-plan.md`). Imports `HrModule` for
 * `EmployeesService` (employee existence/name/designation lookups — see that module's own header
 * comment); three controller/service pairs by concern, same split `HostelModule`/`HrModule`
 * already use.
 */
@Module({
  imports: [HrModule],
  controllers: [
    SalaryStructuresController,
    PayrollPeriodsController,
    PayslipsController,
  ],
  providers: [SalaryStructuresService, PayrollPeriodsService, PayslipsService],
})
export class PayrollModule {}
