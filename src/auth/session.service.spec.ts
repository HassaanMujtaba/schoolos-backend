import { describe, expect, it } from 'vitest';
import { SessionService } from './session.service';
import { RedisService } from '../common/redis/redis.service';
import { AppConfigService } from '../common/config/app-config.service';

/**
 * Minimal in-memory stand-in for the handful of ioredis calls `SessionService` makes — enough to
 * unit-test the rotation/reuse-detection logic (the actually security-sensitive part) without a
 * live Redis. `test/auth.e2e-spec.ts` covers the real thing end to end.
 */
class FakeRedis {
  private strings = new Map<string, string>();
  private sets = new Map<string, Set<string>>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.strings.set(key, value);
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) count += 1;
      if (this.sets.delete(key)) count += 1;
    }
    return Promise.resolve(count);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    members.forEach((m) => set.add(m));
    this.sets.set(key, set);
    return Promise.resolve(members.length);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return Promise.resolve(0);
    let count = 0;
    for (const m of members) {
      if (set.delete(m)) count += 1;
    }
    return Promise.resolve(count);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.resolve(keys.map((k) => this.strings.get(k) ?? null));
  }

  expire(): Promise<number> {
    return Promise.resolve(1);
  }

  multi() {
    const ops: Array<() => void> = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const chain = {
      set(key: string, value: string) {
        ops.push(() => self.strings.set(key, value));
        return chain;
      },
      sadd(key: string, ...members: string[]) {
        ops.push(() => {
          const set = self.sets.get(key) ?? new Set<string>();
          members.forEach((m) => set.add(m));
          self.sets.set(key, set);
        });
        return chain;
      },
      expire() {
        return chain;
      },
      del(key: string) {
        ops.push(() => {
          self.strings.delete(key);
        });
        return chain;
      },
      srem(key: string, member: string) {
        ops.push(() => {
          self.sets.get(key)?.delete(member);
        });
        return chain;
      },
      exec: () => {
        ops.forEach((op) => op());
        return Promise.resolve([]);
      },
    };
    return chain;
  }

  /** Test-only escape hatch to simulate a Redis-side expiry (TTL lapsed) without going through `del`. */
  expireNow(key: string): void {
    this.strings.delete(key);
  }
}

function makeService() {
  const redis = new FakeRedis();
  const config = { jwtRefreshTtl: '30d' } as unknown as AppConfigService;
  const service = new SessionService(redis as unknown as RedisService, config);
  return { service, redis };
}

describe('SessionService', () => {
  it('creates a session and rotates it on refresh, changing the secret but keeping the session id', async () => {
    const { service } = makeService();
    const created = await service.createSession({
      userId: 'u1',
      tenantId: 't1',
      branchId: null,
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/100',
      ip: '127.0.0.1',
    });

    const rotated = await service.rotate(created.cookieValue);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) throw new Error('unreachable');
    expect(rotated.userId).toBe('u1');
    expect(rotated.tenantId).toBe('t1');
    expect(rotated.cookieValue).not.toBe(created.cookieValue);
    expect(rotated.cookieValue.split('.')[0]).toBe(created.sessionId);
  });

  it('rejects an unknown/garbage cookie', async () => {
    const { service } = makeService();
    expect(await service.rotate(undefined)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await service.rotate('not-a-real-cookie')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it(
    'replaying an already-rotated (stale) refresh cookie revokes the whole session — the ' +
      'strongest available signal that a refresh token leaked, not just a rejected single request',
    async () => {
      const { service } = makeService();
      const created = await service.createSession({
        userId: 'u1',
        tenantId: 't1',
        branchId: null,
        userAgent: null,
        ip: null,
      });

      const firstRotation = await service.rotate(created.cookieValue);
      expect(firstRotation.ok).toBe(true);

      // Replay the original (now-superseded) cookie.
      const replay = await service.rotate(created.cookieValue);
      expect(replay).toEqual({ ok: false, reason: 'invalid' });

      // The even-legitimate rotated cookie is now dead too — the whole session was revoked.
      if (firstRotation.ok) {
        const afterRevocation = await service.rotate(firstRotation.cookieValue);
        expect(afterRevocation).toEqual({ ok: false, reason: 'not_found' });
      }
    },
  );

  it('logout-all destroys every session for a user, not just one device', async () => {
    const { service } = makeService();
    const deviceA = await service.createSession({
      userId: 'u1',
      tenantId: 't1',
      branchId: null,
      userAgent: null,
      ip: null,
    });
    const deviceB = await service.createSession({
      userId: 'u1',
      tenantId: 't1',
      branchId: null,
      userAgent: null,
      ip: null,
    });

    expect(await service.listSessions('u1', null)).toHaveLength(2);

    await service.destroyAllSessions('u1');

    expect(await service.rotate(deviceA.cookieValue)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await service.rotate(deviceB.cookieValue)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await service.listSessions('u1', null)).toHaveLength(0);
  });

  it("listSessions marks the caller's own session isCurrent and prunes entries whose Redis key already expired", async () => {
    const { service, redis } = makeService();
    const current = await service.createSession({
      userId: 'u1',
      tenantId: 't1',
      branchId: null,
      userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1',
      ip: null,
    });
    const other = await service.createSession({
      userId: 'u1',
      tenantId: 't1',
      branchId: null,
      userAgent: null,
      ip: null,
    });

    // Simulate the "other" session's TTL lapsing in Redis without an explicit destroy call.
    redis.expireNow(`session:${other.sessionId}`);

    const list = await service.listSessions('u1', current.sessionId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(current.sessionId);
    expect(list[0].isCurrent).toBe(true);
    expect(list[0].label).toBe('Safari on iOS');
  });
});
