const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
};

/**
 * Parses `AppConfigService.jwtRefreshTtl`-style durations (`"15m"`, `"30d"`) into seconds, for
 * Redis `EX` — `@nestjs/jwt`'s `expiresIn` accepts the string form directly, but the Redis
 * session TTL needs a number.
 */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}" — expected e.g. "15m", "30d"`);
  }
  const [, amount, unit] = match;
  // `unit` is one of the regex's own `(s|m|h|d)` capture alternatives, not arbitrary input.
  // eslint-disable-next-line security/detect-object-injection
  return Number(amount) * UNIT_SECONDS[unit];
}
