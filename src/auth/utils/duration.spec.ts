import { describe, expect, it } from 'vitest';
import { parseDurationSeconds } from './duration';

describe('parseDurationSeconds', () => {
  it.each([
    ['15m', 15 * 60],
    ['30d', 30 * 60 * 60 * 24],
    ['1h', 60 * 60],
    ['45s', 45],
  ])('parses %s to %i seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected);
  });

  it.each(['15', '15minutes', '', 'm15', '-5m'])(
    'rejects malformed duration %j',
    (input) => {
      expect(() => parseDurationSeconds(input)).toThrow(/Invalid duration/);
    },
  );
});
