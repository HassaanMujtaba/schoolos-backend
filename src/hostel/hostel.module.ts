import { Module } from '@nestjs/common';
import { HostelStructureController } from './hostel-structure.controller';
import { HostelStructureService } from './hostel-structure.service';
import { HostelAllocationsController } from './hostel-allocations.controller';
import { HostelAllocationsService } from './hostel-allocations.service';
import { HostelVisitorsController } from './hostel-visitors.controller';
import { HostelVisitorsService } from './hostel-visitors.service';
import { HostelComplaintsController } from './hostel-complaints.controller';
import { HostelComplaintsService } from './hostel-complaints.service';

/**
 * PRD §25 Hostel Management (Phase 7.5, `../implementation-plan.md`). Four controller/service
 * pairs by concern, same split-by-concern convention `LibraryModule` already set — `structure`
 * (hostels + rooms + occupancy), `allocations`, `visitors`, `complaints`. `HostelAllocationsService`
 * depends on `HostelStructureService` (room lookups) directly rather than through a shared
 * export/import dance, same one-module-many-services shape `LibraryModule` already uses.
 */
@Module({
  controllers: [
    HostelStructureController,
    HostelAllocationsController,
    HostelVisitorsController,
    HostelComplaintsController,
  ],
  providers: [
    HostelStructureService,
    HostelAllocationsService,
    HostelVisitorsService,
    HostelComplaintsService,
  ],
})
export class HostelModule {}
