import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import { RedisService } from '../common/redis/redis.service';
import { AppConfigService } from '../common/config/app-config.service';
import { parseDurationSeconds } from './utils/duration';

interface SessionRecord {
  userId: string;
  tenantId: string;
  branchId: string | null;
  secretHash: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface SessionDeviceSummary {
  id: string;
  label: string;
  /** Geo-IP lookup isn't wired up yet (no provider chosen) — always `null` until a later phase adds one. */
  location: string | null;
  lastActiveAt: string;
  isCurrent: boolean;
}

export type RotateResult =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      branchId: string | null;
      cookieValue: string;
    }
  | { ok: false; reason: 'not_found' | 'invalid' };

const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user-sessions:';

/**
 * Refresh-token/session store — PRD §5 "session management, device management" and
 * `implementation-plan.md`'s tech-stack choice ("session store in Redis (device/session list,
 * revocation, logout-all)"), not Postgres: high-churn, naturally-expiring data.
 *
 * The refresh cookie value is `${sessionId}.${secret}` (never a JWT itself — nothing here needs
 * to be self-describing, and an opaque token can be revoked by deleting its Redis key, which a
 * signed-but-unrevoked JWT can't be without a denylist). Only `sha256(secret)` is stored, never
 * the secret itself (security-standards A02). Rotation on every refresh: reusing an already-
 * rotated-away secret revokes the session outright rather than silently rejecting the one
 * request — the strongest signal available here that a refresh token has leaked (OWASP ASVS
 * refresh-token-rotation guidance).
 */
@Injectable()
export class SessionService {
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {
    this.refreshTtlSeconds = parseDurationSeconds(config.jwtRefreshTtl);
  }

  async createSession(params: {
    userId: string;
    tenantId: string;
    branchId: string | null;
    userAgent: string | null;
    ip: string | null;
  }): Promise<{ sessionId: string; cookieValue: string }> {
    const sessionId = randomUUID();
    const secret = generateSecret();
    const now = new Date().toISOString();

    const record: SessionRecord = {
      userId: params.userId,
      tenantId: params.tenantId,
      branchId: params.branchId,
      secretHash: hashSecret(secret),
      userAgent: params.userAgent,
      ip: params.ip,
      createdAt: now,
      lastActiveAt: now,
    };

    await this.redis
      .multi()
      .set(
        this.sessionKey(sessionId),
        JSON.stringify(record),
        'EX',
        this.refreshTtlSeconds,
      )
      .sadd(this.userSessionsKey(params.userId), sessionId)
      .expire(this.userSessionsKey(params.userId), this.refreshTtlSeconds)
      .exec();

    return { sessionId, cookieValue: `${sessionId}.${secret}` };
  }

  /** Verifies + rotates a refresh cookie. Deletes the session outright on a stale-secret replay — see class doc comment. */
  async rotate(cookieValue: string | undefined): Promise<RotateResult> {
    const parsed = parseCookieValue(cookieValue);
    if (!parsed) return { ok: false, reason: 'not_found' };

    const raw = await this.redis.get(this.sessionKey(parsed.sessionId));
    if (!raw) return { ok: false, reason: 'not_found' };

    const record = JSON.parse(raw) as SessionRecord;
    if (!secretMatches(parsed.secret, record.secretHash)) {
      // Someone presented a session id with the wrong secret — either a stale, already-rotated
      // token being replayed, or a guess. Either way, kill the session rather than just this
      // request.
      await this.redis.del(this.sessionKey(parsed.sessionId));
      await this.redis.srem(
        this.userSessionsKey(record.userId),
        parsed.sessionId,
      );
      return { ok: false, reason: 'invalid' };
    }

    const newSecret = generateSecret();
    const updated: SessionRecord = {
      ...record,
      secretHash: hashSecret(newSecret),
      lastActiveAt: new Date().toISOString(),
    };
    await this.redis.set(
      this.sessionKey(parsed.sessionId),
      JSON.stringify(updated),
      'EX',
      this.refreshTtlSeconds,
    );

    return {
      ok: true,
      userId: record.userId,
      tenantId: record.tenantId,
      branchId: record.branchId,
      cookieValue: `${parsed.sessionId}.${newSecret}`,
    };
  }

  /** The session id embedded in a refresh cookie, without validating the secret — used to resolve `isCurrent` from an already-authenticated access token, not as an auth check itself. */
  sessionIdFromCookie(cookieValue: string | undefined): string | null {
    return parseCookieValue(cookieValue)?.sessionId ?? null;
  }

  async destroySession(sessionId: string, userId: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.sessionKey(sessionId))
      .srem(this.userSessionsKey(userId), sessionId)
      .exec();
  }

  async destroyAllSessions(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(this.userSessionsKey(userId));
    if (sessionIds.length > 0) {
      await this.redis.del(...sessionIds.map((id) => this.sessionKey(id)));
    }
    await this.redis.del(this.userSessionsKey(userId));
  }

  async listSessions(
    userId: string,
    currentSessionId: string | null,
  ): Promise<SessionDeviceSummary[]> {
    const sessionIds = await this.redis.smembers(this.userSessionsKey(userId));
    if (sessionIds.length === 0) return [];

    const raws = await this.redis.mget(
      ...sessionIds.map((id) => this.sessionKey(id)),
    );
    const summaries: SessionDeviceSummary[] = [];
    const staleIds: string[] = [];

    sessionIds.forEach((id, index) => {
      // `index` is this same bounded `forEach` loop's own counter, not user input.
      // eslint-disable-next-line security/detect-object-injection
      const raw = raws[index];
      if (!raw) {
        staleIds.push(id); // expired since the set entry was added — prune it below
        return;
      }
      const record = JSON.parse(raw) as SessionRecord;
      summaries.push({
        id,
        label: deriveDeviceLabel(record.userAgent),
        location: null,
        lastActiveAt: record.lastActiveAt,
        isCurrent: id === currentSessionId,
      });
    });

    if (staleIds.length > 0) {
      await this.redis.srem(this.userSessionsKey(userId), ...staleIds);
    }

    return summaries.sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
  }

  private sessionKey(sessionId: string): string {
    return `${SESSION_PREFIX}${sessionId}`;
  }

  private userSessionsKey(userId: string): string {
    return `${USER_SESSIONS_PREFIX}${userId}`;
  }
}

function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function secretMatches(secret: string, hash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

function parseCookieValue(
  value: string | undefined,
): { sessionId: string; secret: string } | null {
  if (!value) return null;
  const separatorIndex = value.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null;
  return {
    sessionId: value.slice(0, separatorIndex),
    secret: value.slice(separatorIndex + 1),
  };
}

/** Best-effort, dependency-free device label — good enough for a "which of my devices is this" list, not a precise UA parse. */
function deriveDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;

  if (os && browser) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}
