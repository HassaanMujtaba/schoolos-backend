import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../common/config/app-config.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AccessTokenPayload } from '../jwt-payload.interface';

/**
 * Verifies the `Authorization: Bearer` access token and — this is the one place it happens —
 * populates `RequestContextService` from the *validated* payload, per PRD §52 / security-
 * standards: "never trust tenantId from the client." `JwtAuthGuard` (which wraps this strategy)
 * is a global guard, so this runs before `PermissionsGuard` on every non-`@Public()` route.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: AppConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtAccessSecret,
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid access token');
    }

    this.requestContext.patch({
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      userId: payload.sub,
      permissions: payload.permissions,
    });

    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      email: payload.email,
      name: payload.name,
      roles: payload.roles,
      permissions: payload.permissions,
      sessionId: payload.sid,
    };
  }
}
