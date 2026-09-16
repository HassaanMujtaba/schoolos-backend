/**
 * Pakistan Standard Time helpers for subscription billing math (`platform/subscriptions.service.ts`,
 * `platform/subscription-sweep.service.ts`) — the system-wide PKT default per the platform's
 * "Pakistan only, for now" posture (see `School.timezone`'s own doc comment, a separate per-tenant
 * concern this file has nothing to do with).
 *
 * Fixed `+05:00` offset arithmetic, not a timezone-database lookup: Pakistan has observed no DST
 * since 2002, so `Asia/Karachi` is UTC+05:00 year-round with no historical-offset ambiguity to get
 * wrong — plain arithmetic is correct here and avoids pulling in a timezone library this codebase
 * doesn't otherwise need.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant (UTC `Date`) corresponding to 00:00 PKT "today," by PKT's own calendar. */
export function startOfTodayPkt(now: Date = new Date()): Date {
  const pktNow = new Date(now.getTime() + PKT_OFFSET_MS);
  const startOfDayPkt = Date.UTC(
    pktNow.getUTCFullYear(),
    pktNow.getUTCMonth(),
    pktNow.getUTCDate(),
  );
  return new Date(startOfDayPkt - PKT_OFFSET_MS);
}

/**
 * Adds one calendar month in PKT terms (28 Feb → 28 Mar, not "+30 days") — the unit a monthly
 * subscription period is actually denominated in. Clamps to the target month's last day for an
 * end-of-month start date (31 Jan → 28/29 Feb), same as every common billing-cycle convention.
 */
export function addOneMonthPkt(date: Date): Date {
  const pkt = new Date(date.getTime() + PKT_OFFSET_MS);
  const year = pkt.getUTCFullYear();
  const month = pkt.getUTCMonth();
  const day = pkt.getUTCDate();
  const targetMonth = month + 1;
  const daysInTargetMonth = new Date(
    Date.UTC(year, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  const result = Date.UTC(
    year,
    targetMonth,
    clampedDay,
    pkt.getUTCHours(),
    pkt.getUTCMinutes(),
    pkt.getUTCSeconds(),
    pkt.getUTCMilliseconds(),
  );
  return new Date(result - PKT_OFFSET_MS);
}

export function addDaysPkt(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
