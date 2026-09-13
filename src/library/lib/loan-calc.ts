/**
 * Server-side mirror of `frontend/src/features/library/lib/dueDate.ts` and `lib/fines.ts` —
 * the frontend's own pure functions stay in place as a client-side preview
 * (`CirculationDesk`'s pre-return fine estimate), but `LibraryCirculationService` is what's
 * actually authoritative now (`modules/library.md` "Circulation ... fines (flat per-day rate,
 * optionally capped)" — the server's own `fineAmount` on the return response is what's charged,
 * per that doc's own "Fine rate" open-question resolution).
 *
 * Operates on `@db.Date` `Date` objects (UTC midnight, `common/dates/date-only.ts`'s convention)
 * rather than the frontend's local-timezone `Date` math — since every date here only ever carries
 * a calendar day, not a time-of-day, UTC day arithmetic gives the same whole-day answer without
 * needing to know the caller's timezone.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function calculateDueDate(issuedAt: Date, loanPeriodDays: number): Date {
  const due = new Date(issuedAt.getTime());
  due.setUTCDate(due.getUTCDate() + loanPeriodDays);
  return due;
}

/** Whole days overdue as of `asOf`; 0 if not yet (or just) due. */
export function daysOverdue(dueAt: Date, asOf: Date): number {
  const diffDays = Math.round((asOf.getTime() - dueAt.getTime()) / MS_PER_DAY);
  return Math.max(0, diffDays);
}

export function calculateFine(
  dueAt: Date,
  returnedAt: Date,
  finePerDayRate: number,
  maxFine?: number | null,
): number {
  const fine = daysOverdue(dueAt, returnedAt) * finePerDayRate;
  return maxFine ? Math.min(fine, maxFine) : fine;
}
