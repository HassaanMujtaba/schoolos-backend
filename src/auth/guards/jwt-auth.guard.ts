import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

/**
 * Global auth gate (registered as `APP_GUARD` in `app.module.ts`, before `PermissionsGuard`) —
 * every route requires a valid access token unless explicitly `@Public()`. This is what makes
 * "no auth" a visible, deliberate annotation rather than an accidental omission, per
 * `common/decorators/public.decorator.ts`'s own doc comment.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    return super.canActivate(context);
  }
}
