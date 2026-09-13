import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { RolesService } from './roles.service';
import {
  PermissionResponseDto,
  RoleResponseDto,
  UpdateRolePermissionsDto,
} from './dto/role.dto';

/**
 * RBAC management (`modules/platform-console.md`'s Roles screen) — which permissions each of PRD
 * §4's fixed roles grants. Global, not tenant-scoped (see `Role`'s own schema comment), so this
 * sits alongside `plans.controller.ts`/`feature-flags.controller.ts`, Super Admin only. The
 * mutating route is `@SkipAudit()` for the exact reason every other route in this module is —
 * `RolesService` writes its own row via `PlatformAuditLogService`, see that class's doc comment.
 */
@ApiTags('platform')
@Controller('platform/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('platform.roles.manage')
  list(): Promise<RoleResponseDto[]> {
    return this.roles.listRoles();
  }

  @Get('permissions')
  @RequirePermission('platform.roles.manage')
  listPermissions(): Promise<PermissionResponseDto[]> {
    return this.roles.listPermissions();
  }

  @Patch(':id/permissions')
  @RequirePermission('platform.roles.manage')
  @SkipAudit()
  updatePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    return this.roles.updatePermissions(id, dto);
  }
}
