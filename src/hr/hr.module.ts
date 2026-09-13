import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeLeaveController } from './employee-leave.controller';
import { EmployeeLeaveService } from './employee-leave.service';

/**
 * PRD §21 HR Management + §14 Employee Leave (Phase 7.6, `../implementation-plan.md`). Two
 * controller/service pairs by concern, same split-by-concern convention `HostelModule` already
 * set — employee directory/lifecycle and employee leave. `EmployeesService` is exported:
 * `PayrollModule` imports it for the employee-existence/name/designation lookups a payslip needs,
 * same `FeesModule`→`InvoicesService` cross-module pattern `AdmissionsModule` already uses.
 */
@Module({
  controllers: [EmployeesController, EmployeeLeaveController],
  providers: [EmployeesService, EmployeeLeaveService],
  exports: [EmployeesService],
})
export class HrModule {}
