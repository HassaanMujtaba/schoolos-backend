import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * `frontend/modules/reports-analytics.md` (Phase 7.8). Imports `FeesModule` for its exported
 * `InvoicesService.getOutstanding` — same cross-module-reuse pattern `AdmissionsModule`→
 * `FeesModule` and `PayrollModule`→`HrModule` already establish, rather than re-deriving the
 * outstanding-balance math a third way here.
 */
@Module({
  imports: [FeesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
