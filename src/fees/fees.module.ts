import { Module } from '@nestjs/common';
import { FeeStructuresController } from './fee-structures.controller';
import { InvoicesController } from './invoices.controller';
import { PaymentsController } from './payments.controller';
import { OutstandingController } from './outstanding.controller';
import { FeeStructuresService } from './fee-structures.service';
import { InvoicesService } from './invoices.service';

/**
 * `frontend/modules/fees.md` — closes the PRD §65 MVP. `InvoicesService` is exported:
 * `AdmissionsModule` imports it for the admissions↔fees ordering integration
 * (`../../implementation-plan.md`'s resolved Phase 3 decision) rather than duplicating invoice
 * generation there. Accounting (§19) is deliberately not part of this module — see `Invoice`'s
 * schema.prisma header comment and this phase's own note in `../../implementation-plan.md`.
 */
@Module({
  controllers: [
    FeeStructuresController,
    InvoicesController,
    PaymentsController,
    OutstandingController,
  ],
  providers: [FeeStructuresService, InvoicesService],
  exports: [InvoicesService],
})
export class FeesModule {}
