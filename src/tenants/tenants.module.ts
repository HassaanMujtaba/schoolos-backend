import { Module } from '@nestjs/common';
import { BranchesController } from './branches/branches.controller';
import { BranchesService } from './branches/branches.service';

/**
 * PRD §6 Branch Management (`../implementation-plan.md`'s folder structure: "tenants/ + branches/").
 * `Tenant` itself (Phase 0) has no CRUD surface yet — no frontend module calls a `/tenants`
 * endpoint; this module today is just the branches feature.
 */
@Module({
  controllers: [BranchesController],
  providers: [BranchesService],
})
export class TenantsModule {}
