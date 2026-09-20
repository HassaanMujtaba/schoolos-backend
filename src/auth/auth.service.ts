import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppConfigService } from '../common/config/app-config.service';
import { RedisService } from '../common/redis/redis.service';
import { MailerService } from '../common/mailer/mailer.service';
import { UsersService, UserAuthProfile } from '../users/users.service';
import { SessionService, SessionDeviceSummary } from './session.service';
import { AccessTokenPayload } from './jwt-payload.interface';
import { AuthSessionDto, MeResponseDto } from './dto/auth-response.dto';
import { parseDurationSeconds } from './utils/duration';

const BCRYPT_COST = 12;
// A precomputed hash checked when no user matches an identifier, so a login attempt against a
// nonexistent account takes roughly the same time as one against a real account with the wrong
// password — a cheap mitigation against timing-based user enumeration, not a complete one.
const DUMMY_HASH = bcrypt.hashSync('no-such-account', BCRYPT_COST);

const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface LoginResult {
  session: AuthSessionDto;
  refreshCookieValue: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshCookieValue: string;
}

/**
 * `modules/auth.md`'s "Backend dependencies" contract, end to end. One real design decision this
 * makes that the frontend's assumed contract doesn't address: `LoginDto.identifier` carries no
 * tenant/school selector, but `User.email`/`phone` are only unique *within* a tenant
 * (`schema.prisma`). See `UsersService.findAuthCandidatesByIdentifier`'s doc comment — this
 * service treats anything other than exactly one cross-tenant match as "no such user" and fails
 * closed, rather than guessing a tenant. Flagged in `../../implementation-plan.md`'s Phase 1
 * integration notes as a real, unconfirmed contract gap worth a product conversation once
 * multiple schools with colliding identifiers actually shows up.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtlSeconds: number;
  private readonly frontendBaseUrl: string;

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    config: AppConfigService,
  ) {
    this.accessTtlSeconds = parseDurationSeconds(config.jwtAccessTtl);
    this.frontendBaseUrl = config.frontendBaseUrl;
  }

  async login(
    identifier: string,
    password: string,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    await this.assertNotLockedOut(identifier);

    const candidates =
      await this.users.findAuthCandidatesByIdentifier(identifier);
    const user = candidates.length === 1 ? candidates[0] : null;

    const passwordOk = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !passwordOk) {
      await this.recordFailedAttempt(identifier);
      if (candidates.length > 1) {
        // Same identifier resolved in more than one tenant — never guess which one was meant.
        this.logger.warn(
          `Login identifier resolved to ${candidates.length} tenants; refusing to pick one`,
        );
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.clearFailedAttempts(identifier);

    const { sessionId, cookieValue } = await this.sessions.createSession({
      userId: user.id,
      tenantId: user.tenantId,
      branchId: user.branchId,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    const accessToken = await this.signAccessToken(user, sessionId);

    return {
      session: {
        accessToken,
        user: toAuthUser(user),
        roles: user.roles,
        permissions: user.permissions,
      },
      refreshCookieValue: cookieValue,
    };
  }

  async refresh(cookieValue: string | undefined): Promise<RefreshResult> {
    const rotated = await this.sessions.rotate(cookieValue);
    if (!rotated.ok) {
      throw new UnauthorizedException(
        'Session expired or invalid — please log in again',
      );
    }

    // Re-fetch rather than trust anything from the old token, so a role/permission change since
    // the last refresh takes effect within one refresh cycle instead of lasting the full
    // (rotating, effectively unbounded) refresh-token lifetime.
    const user = await this.users.findAuthProfileById(rotated.userId);
    if (!user) {
      await this.sessions.destroyAllSessions(rotated.userId);
      throw new UnauthorizedException('Account no longer active');
    }

    const sessionId = this.sessions.sessionIdFromCookie(rotated.cookieValue);
    if (!sessionId) {
      // Unreachable in practice — `rotate()` only returns `ok: true` with a well-formed cookie —
      // but fail closed rather than mint a token with a garbage `sid` claim if it ever isn't.
      throw new UnauthorizedException(
        'Session expired or invalid — please log in again',
      );
    }

    const accessToken = await this.signAccessToken(user, sessionId);
    return { accessToken, refreshCookieValue: rotated.cookieValue };
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.sessions.destroySession(sessionId, userId);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessions.destroyAllSessions(userId);
  }

  me(user: {
    id: string;
    name: string;
    email: string;
    branchId: string | null;
    roles: string[];
    permissions: string[];
  }): MeResponseDto {
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        activeBranchId: user.branchId,
      },
      roles: user.roles,
      permissions: user.permissions,
    };
  }

  async listSessions(
    userId: string,
    currentSessionId: string | null,
  ): Promise<SessionDeviceSummary[]> {
    return this.sessions.listSessions(userId, currentSessionId);
  }

  /**
   * Always resolves the same way regardless of whether `identifier` matched an account — never
   * lets a caller distinguish "sent" from "no such account" (security-standards A07/user
   * enumeration). Delivered via `MailerService` — a real send once SMTP is configured, a
   * `[dev-only]` log otherwise (that service's own doc comment).
   */
  async forgotPassword(identifier: string): Promise<void> {
    const candidates =
      await this.users.findAuthCandidatesByIdentifier(identifier);
    if (candidates.length !== 1) return;

    const user = candidates[0];
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.resetTokenKey(token),
      user.id,
      'EX',
      PASSWORD_RESET_TTL_SECONDS,
    );

    await this.mailer.send({
      to: user.email,
      subject: 'Reset your SchoolOS password',
      html: resetPasswordEmail(user.name, this.resetLink(token)),
    });
  }

  /**
   * Issues the same kind of one-time token as `forgotPassword`, for a user who can't request one
   * themselves — `POST /platform/schools`' onboarding flow (Phase 7.9) is the one caller: it
   * creates a school's first Owner as `status: INVITED` with no usable password, and
   * `forgotPassword`'s own `findAuthCandidatesByIdentifier` lookup only ever resolves an
   * already-`ACTIVE` account, so it can't be the thing that gets this account its first token.
   * Takes `email`/`name` directly rather than looking the user up — the caller (`SchoolsService.
   * create`) already has both from the row it just created, and `INVITED` accounts don't resolve
   * through `UsersService`'s own active-only lookups anyway.
   *
   * Returns the link rather than `void` so a caller can surface it directly (the platform console
   * does, on the school onboarding/resend-invite responses) — mail delivery is best-effort
   * (`MailerService`'s own doc comment) and this project's Render deploy currently can't reach any
   * SMTP host at all, so the link itself is the only way to actually test the invite flow. Safe to
   * return here: every caller is already gated on `platform.schools.manage`, the same trust level
   * required to trigger this action in the first place.
   */
  async issueInviteToken(
    userId: string,
    email: string,
    name: string,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.resetTokenKey(token),
      userId,
      'EX',
      PASSWORD_RESET_TTL_SECONDS,
    );
    const link = this.resetLink(token);
    await this.mailer.send({
      to: email,
      subject: 'Welcome to SchoolOS — set your password',
      html: inviteEmail(name, link),
    });
    return link;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.redis.get(this.resetTokenKey(token));
    if (!userId) {
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    }
    await this.redis.del(this.resetTokenKey(token));

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.users.setPasswordAndActivate(userId, passwordHash);
    // A password change invalidates every existing session, including the one that requested
    // the reset — force a fresh login everywhere, the same posture as most consumer auth flows.
    await this.sessions.destroyAllSessions(userId);
  }

  private async signAccessToken(
    user: UserAuthProfile,
    sessionId: string,
  ): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      branchId: user.branchId,
      email: user.email,
      name: user.name,
      jti: randomUUID(),
      roles: user.roles,
      permissions: user.permissions,
      sid: sessionId,
    };
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds });
  }

  private async assertNotLockedOut(identifier: string): Promise<void> {
    const attempts = await this.redis.get(this.loginAttemptsKey(identifier));
    if (attempts && Number(attempts) >= LOGIN_ATTEMPT_LIMIT) {
      throw new UnauthorizedException(
        'Too many failed login attempts — try again later',
      );
    }
  }

  private async recordFailedAttempt(identifier: string): Promise<void> {
    const key = this.loginAttemptsKey(identifier);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, LOGIN_ATTEMPT_WINDOW_SECONDS);
    }
  }

  private async clearFailedAttempts(identifier: string): Promise<void> {
    await this.redis.del(this.loginAttemptsKey(identifier));
  }

  private loginAttemptsKey(identifier: string): string {
    return `login-attempts:${hashIdentifier(identifier)}`;
  }

  private resetTokenKey(token: string): string {
    return `password-reset:${createHash('sha256').update(token).digest('hex')}`;
  }

  private resetLink(token: string): string {
    return `${this.frontendBaseUrl}/reset-password?token=${token}`;
  }
}

function toAuthUser(user: UserAuthProfile) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    activeBranchId: user.branchId,
  };
}

// Never store a raw identifier (email/phone, both PII) as a Redis key that could show up in
// slow-log output or a keys-scan — hash it instead, same spirit as the refresh-secret hashing.
function hashIdentifier(identifier: string): string {
  return createHash('sha256')
    .update(identifier.trim().toLowerCase())
    .digest('hex');
}

function resetPasswordEmail(name: string, link: string): string {
  return `
    <p>Hi ${name},</p>
    <p>We received a request to reset your SchoolOS password. This link expires in 30 minutes:</p>
    <p><a href="${link}">${link}</a></p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `;
}

function inviteEmail(name: string, link: string): string {
  return `
    <p>Hi ${name},</p>
    <p>Your school has been set up on SchoolOS. Set your password to log in for the first time
    (this link expires in 30 minutes):</p>
    <p><a href="${link}">${link}</a></p>
  `;
}
