import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles/vehicles.controller';
import { VehiclesService } from './vehicles/vehicles.service';
import { RoutesController } from './routes/routes.controller';
import { RoutesService } from './routes/routes.service';

/**
 * PRD §23 Transport Management (Phase 7.3, `../implementation-plan.md`). Vehicle/route management
 * only — live tracking (GPS WebSocket channel, geofencing, pickup/drop-off confirmation) is its
 * own not-yet-scheduled sub-phase, per `modules/transport.md`'s own phase-ordering call. Two
 * controller/service pairs by concern, same split-by-concern-not-by-prefix convention
 * `LibraryModule` already set — `vehicles/` and `routes/` each own their own subdirectory
 * (DTOs included) rather than everything living flat under `transport/`.
 */
@Module({
  controllers: [VehiclesController, RoutesController],
  providers: [VehiclesService, RoutesService],
})
export class TransportModule {}
