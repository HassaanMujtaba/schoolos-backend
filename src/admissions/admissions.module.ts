import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';

/**
 * Imports `FeesModule` (Phase 6) for the admissions↔fees ordering integration — see
 * `AdmissionsService`'s own doc comments on the `fee_payment` transition and `enroll` —
 * `InvoicesService` is the only thing consumed from it.
 */
@Module({
  imports: [FeesModule],
  controllers: [AdmissionsController],
  providers: [AdmissionsService],
})
export class AdmissionsModule {}
