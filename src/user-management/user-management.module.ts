import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserManagementController } from './user-management.controller';
import { UserManagementService } from './user-management.service';

/**
 * Tenant-scoped staff user management — deliberately its own module rather than living inside
 * `src/users/` (that module's existing `UsersService` is unscoped, auth-internal, and `AuthModule`
 * already imports it; importing `AuthModule` back from there for `AuthService.issueInviteToken`/
 * `logoutAll` would be circular). This direction — importing `AuthModule` from here — isn't.
 */
@Module({
  imports: [AuthModule],
  controllers: [UserManagementController],
  providers: [UserManagementService],
})
export class UserManagementModule {}
