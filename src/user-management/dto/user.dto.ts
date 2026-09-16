import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { PagedResult } from '../../common/pagination/list-query.dto';

/**
 * Every seeded role (`prisma/seed.ts`'s `ROLES`) except `super_admin` (platform-only) and
 * `student`/`parent` (portal accounts — not created here; linking a login to a Student/Parent
 * record is a separate, not-yet-built feature, same gap `test/academics.e2e-spec.ts`'s own "no
 * portal user is linked to a Student yet" comment documents). Kept as a plain array here (not
 * read from the `Role` table at validation time) so a malformed request 400s before touching the
 * database — `UserManagementService`/`Controller.listAssignableRoles` still resolve these against
 * the real seeded catalog, so a key listed here that somehow isn't seeded yet fails loudly there
 * instead of silently succeeding.
 */
export const ASSIGNABLE_ROLE_KEYS = [
  'school_owner',
  'school_admin',
  'principal',
  'vice_principal',
  'academic_coordinator',
  'teacher',
  'accountant',
  'hr_manager',
  'receptionist',
  'librarian',
  'transport_manager',
  'driver',
  'nurse',
  'hostel_warden',
  'inventory_manager',
] as const;

export const USER_STATUSES = ['active', 'suspended', 'invited'] as const;

/** `POST /users` — `frontend/src/features/users/schemas.ts`'s `createUserSchema`. Creates an `INVITED` account and emails a set-password invite, same flow `platform/schools.service.ts`'s school-owner onboarding already uses. */
export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(200)
  email!: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLE_KEYS, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one role' })
  @ArrayUnique()
  @IsIn(ASSIGNABLE_ROLE_KEYS, { each: true })
  roleKeys!: (typeof ASSIGNABLE_ROLE_KEYS)[number][];
}

/** `PATCH /users/:id/roles` — replaces the user's entire role set, same "always the full checked list, never a diff" contract `platform/roles.controller.ts`'s `updateRolePermissions` already documents for the analogous role↔permission edit. */
export class UpdateUserRolesDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLE_KEYS, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one role' })
  @ArrayUnique()
  @IsIn(ASSIGNABLE_ROLE_KEYS, { each: true })
  roleKeys!: (typeof ASSIGNABLE_ROLE_KEYS)[number][];
}

/** `PATCH /users/:id/status` — suspend/reactivate only; `invited` isn't a settable target (it's the state a new account starts in until `AuthService.resetPassword` activates it). */
export class UpdateUserStatusDto {
  @ApiProperty({ enum: ['active', 'suspended'] })
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';
}

/** `frontend/src/features/users/api.ts`'s `User`. */
export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: USER_STATUSES })
  status!: (typeof USER_STATUSES)[number];
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty() createdAt!: string;
}

export class PagedUsersDto implements PagedResult<UserResponseDto> {
  @ApiProperty({ type: [UserResponseDto] }) items!: UserResponseDto[];
  @ApiProperty() total!: number;
}

export class AssignableRoleDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
}
