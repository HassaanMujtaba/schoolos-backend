/**
 * Every date-only field in the school-setup contract (`AcademicYear`/`Term`/`Holiday`'s
 * start/end/date fields) round-trips as a plain `"YYYY-MM-DD"` string — the frontend's
 * `<input type="date">` fields bind the fetched value straight back in with no reformatting
 * (`features/school-setup/components/AcademicYearForm.tsx` sets `defaultValues` directly from the
 * API response), so returning a full ISO timestamp here would silently blank those inputs on
 * edit. Stored as `@db.Date` in Postgres (no time-of-day component); these two functions are the
 * only place that string ⇄ `Date` conversion happens.
 */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
