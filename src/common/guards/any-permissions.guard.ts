import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY } from '../decorators/require-any-permission.decorator';
import { RequestContextService } from '../context/request-context.service';

/**
 * `PermissionsGuard`'s OR counterpart — see `@RequireAnyPermission`'s own doc comment. A handler
 * with no `@RequireAnyPermission` decorator is allowed through by this guard, same fail-open-on-
 * absent-metadata shape as `PermissionsGuard` (pair with that guard, `@Public()`, or plain
 * authentication for routes that don't need this).
 */
@Injectable()
export class AnyPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const granted = new Set(this.requestContext.permissions);
    const hasAny = required.some((permission) => granted.has(permission));

    if (!hasAny) {
      throw new ForbiddenException(
        `Missing required permission (any of): ${required.join(', ')}`,
      );
    }

    return true;
  }
}
