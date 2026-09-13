import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

/**
 * `PATCH /platform/roles/:id/permissions` — replaces a role's full permission set (the frontend
 * sends the complete checked list every time, not a diff to merge; same "send the whole set"
 * shape `RouteForm`'s `studentIds` uses on the tenant side).
 */
export class UpdateRolePermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  permissionKeys!: string[];
}

/** The fixed, seeded permission catalog — `GET /platform/roles/permissions`. */
export class PermissionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
}

/** `GET /platform/roles` and the response of `PATCH /platform/roles/:id/permissions`. */
export class RoleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  /** `true` for every seeded role (PRD §4's fixed catalog) — self-service custom roles aren't
   * built this phase, same scope call `feature-flag.dto.ts` makes for flag *creation*. */
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ type: [String] }) permissionKeys!: string[];
}
