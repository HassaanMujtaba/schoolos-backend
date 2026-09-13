import { Module } from '@nestjs/common';
import { LibraryCatalogController } from './library-catalog.controller';
import { LibraryCatalogService } from './library-catalog.service';
import { LibraryMembersController } from './library-members.controller';
import { LibraryMembersService } from './library-members.service';
import { LibrarySettingsController } from './library-settings.controller';
import { LibrarySettingsService } from './library-settings.service';
import { LibraryCirculationController } from './library-circulation.controller';
import { LibraryCirculationService } from './library-circulation.service';
import { LibraryReservationsController } from './library-reservations.controller';
import { LibraryReservationsService } from './library-reservations.service';

/**
 * PRD §22 Library Management (Phase 7.2, `../implementation-plan.md`). Split into five
 * controller/service pairs by concern (catalog, members, settings, circulation, reservations) —
 * `LibraryCatalogController`/`LibraryCirculationController` both mount at the bare `library`
 * prefix (Nest allows multiple controllers sharing a prefix; their individual route paths never
 * collide), matching `api.ts`'s own flat `/library/...` surface rather than forcing every
 * sub-resource under its own nested prefix the way `fees/` does.
 */
@Module({
  controllers: [
    LibraryCatalogController,
    LibraryMembersController,
    LibrarySettingsController,
    LibraryCirculationController,
    LibraryReservationsController,
  ],
  providers: [
    LibraryCatalogService,
    LibraryMembersService,
    LibrarySettingsService,
    LibraryCirculationService,
    LibraryReservationsService,
  ],
})
export class LibraryModule {}
