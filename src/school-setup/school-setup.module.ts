import { Module } from '@nestjs/common';
import { SchoolsController } from './schools/schools.controller';
import { SchoolsService } from './schools/schools.service';
import { AcademicYearsController } from './academic-years/academic-years.controller';
import { AcademicYearsService } from './academic-years/academic-years.service';
import { ClassesController } from './classes/classes.controller';
import { ClassesService } from './classes/classes.service';
import { SectionsController } from './sections/sections.controller';
import { SectionsService } from './sections/sections.service';
import { SubjectsController } from './subjects/subjects.controller';
import { SubjectsService } from './subjects/subjects.service';

/**
 * PRD §6 School Setup & Core Entities (Phase 2, `../implementation-plan.md`). School profile,
 * academic years, classes, sections, subjects — see `frontend/modules/school-setup.md` for the
 * contract every controller/service pair here implements. `Branch` (also §6) lives in
 * `tenants/` instead, matching `../implementation-plan.md`'s folder structure.
 */
@Module({
  controllers: [
    SchoolsController,
    AcademicYearsController,
    ClassesController,
    SectionsController,
    SubjectsController,
  ],
  providers: [
    SchoolsService,
    AcademicYearsService,
    ClassesService,
    SectionsService,
    SubjectsService,
  ],
  // `SchoolsService` is exported for Phase 7.1's `CertificatesModule` — certificate PDFs apply
  // school branding (name/logo) automatically per `modules/documents-certificates.md`'s
  // "Certificates" requirements, reusing this service's own lazy-create-on-first-access semantics
  // rather than duplicating that `getOrCreate` logic.
  exports: [SchoolsService],
})
export class SchoolSetupModule {}
