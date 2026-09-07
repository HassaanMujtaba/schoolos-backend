import { Module } from '@nestjs/common';
import { SchoolSetupModule } from '../school-setup/school-setup.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

/**
 * PRD §32 Certificate Management (Phase 7.1, `../implementation-plan.md`). Imports
 * `SchoolSetupModule` for `SchoolsService` — certificate PDFs apply school branding automatically,
 * reusing that service's own lazy-create-on-first-access semantics rather than duplicating it.
 * `StorageService`/`PlatformPrismaService` are both `@Global()` (`storage.module.ts`/
 * `prisma.module.ts`), so neither needs an explicit import here.
 */
@Module({
  imports: [SchoolSetupModule],
  controllers: [CertificatesController],
  providers: [CertificatesService],
})
export class CertificatesModule {}
