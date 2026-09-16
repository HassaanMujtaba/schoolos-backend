import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { UserManagementService } from './user-management.service';
import {
  AssignableRoleDto,
  CreateUserDto,
  PagedUsersDto,
  UpdateUserRolesDto,
  UpdateUserStatusDto,
  UserResponseDto,
} from './dto/user.dto';

/** `GET/POST/PATCH /users` — a School Owner/Admin's own staff directory. Distinct from `platform/platform-users.controller.ts`'s cross-tenant Super Admin search (`platform.support.read`, different permission, different data shape entirely). */
@ApiTags('users')
@Controller('users')
export class UserManagementController {
  constructor(private readonly users: UserManagementService) {}

  // Declared before `:id` — same reasoning `TeachersController`'s `me/dashboard` route comment
  // gives: a literal segment ahead of the catch-all so this never gets swallowed by `GET /users/:id`.
  @Get('assignable-roles')
  @RequirePermission('users.read')
  listAssignableRoles(): Promise<AssignableRoleDto[]> {
    return this.users.listAssignableRoles();
  }

  @Get()
  @RequirePermission('users.read')
  list(@Query() query: ListQueryDto): Promise<PagedUsersDto> {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermission('users.read')
  get(@Param('id') id: string): Promise<UserResponseDto> {
    return this.users.get(id);
  }

  @Post()
  @RequirePermission('users.create')
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.users.create(dto);
  }

  @Patch(':id/roles')
  @RequirePermission('users.update')
  updateRoles(
    @Param('id') id: string,
    @Body() dto: UpdateUserRolesDto,
  ): Promise<UserResponseDto> {
    return this.users.updateRoles(id, dto);
  }

  @Patch(':id/status')
  @RequirePermission('users.deactivate')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<UserResponseDto> {
    return this.users.updateStatus(id, dto);
  }
}
