import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

/**
 * A bcrypt hash of a value nobody will ever type — `bcrypt.compare` always returns false against
 * it, which is what actually keeps an invited-but-not-yet-activated account from logging in
 * before `AuthService.resetPassword` sets a real one (its `status: INVITED` already blocks login
 * via `UsersService.findAuthCandidatesByIdentifier`'s own `status: 'ACTIVE'` filter — this is a
 * second, independent lock, not a load-bearing one). Shared by every flow that creates an
 * account with no password of its own yet: `platform/schools.service.ts`'s school-owner
 * onboarding and `user-management/user-management.service.ts`'s staff invites.
 */
export function unusablePasswordHash(): string {
  return bcrypt.hashSync(randomUUID(), 10);
}
