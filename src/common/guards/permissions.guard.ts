import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { RequestContextService } from '../context/request-context.service';

/**
 * The one gate every mutating (and most read) endpoints go through — PRD §52's pipeline step
 * "Permission Check." Reads the permission strings `@RequirePermission(...)` attached to the
 * handler and checks them against the *server-resolved* permission set on the request context
 * (populated by Phase 1's auth guard from the verified token), never against anything the client
 * asserts about its own role. A handler with no `@RequirePermission` decorator is allowed through
 * by this guard — pair it with `JwtAuthGuard` (Phase 1) for "authenticated but no specific
 * permission required" routes, or `@Public()` for genuinely unauthenticated ones.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const granted = new Set(this.requestContext.permissions);
    const missing = required.filter((permission) => !granted.has(permission));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
