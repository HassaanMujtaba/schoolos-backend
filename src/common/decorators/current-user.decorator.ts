import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  branchId: string | null;
  email: string;
  roles: string[];
  permissions: string[];
}

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/**
 * Reads the authenticated user off the request (populated by Phase 1's `JwtAuthGuard`, mirroring
 * `frontend/src/stores/sessionStore.ts`'s `{ user, roles, permissions }` shape so the two sides
 * stay easy to compare). Never populated by anything client-supplied.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
