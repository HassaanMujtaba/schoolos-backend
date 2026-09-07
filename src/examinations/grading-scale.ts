/**
 * PRD §16's "Grade calculation" / "GPA" / "Ranking" — implemented entirely server-side, per
 * `modules/examinations.md`'s own resolved assumption ("grade/GPA/ranking are treated as
 * server-computed... this module only displays them").
 *
 * There is no school-configurable grading-system screen yet — `school-setup.md`'s "Grading
 * systems" is its own deferred item, and `examinations.md`'s "Open questions" explicitly flags
 * this as something to "re-verify once the school's grading-system config... actually exists."
 * Until then this is **one fixed percentage → grade/GPA scale, applied tenant-wide** — a real,
 * flagged placeholder (same honesty standard as `timetable.service.ts`'s `generate()` filler and
 * the documents malware-scan stub), not a per-school setting invented to look configurable.
 * Swap this for a real per-tenant `GradingScale` lookup once that config screen ships; nothing
 * downstream (`ExaminationsService`) needs to change shape when it does — both functions here
 * already take a plain percentage in and return `{ grade, gpa }`/`rank` out.
 */

interface GradeBand {
  min: number;
  grade: string;
  gpa: number;
}

// Descending by `min` — the first band a percentage clears, wins. 4.0-scale GPA, matching the
// common eight-band scale (A+ through F) rather than a five-letter A–F scale, since PRD §16 lists
// "Grade calculation", "GPA", and "Percentage" as three distinct features, implying more
// granularity than a bare letter grade alone would carry.
const GRADE_BANDS: readonly GradeBand[] = [
  { min: 90, grade: 'A+', gpa: 4.0 },
  { min: 80, grade: 'A', gpa: 3.7 },
  { min: 70, grade: 'B+', gpa: 3.3 },
  { min: 60, grade: 'B', gpa: 3.0 },
  { min: 50, grade: 'C+', gpa: 2.7 },
  { min: 40, grade: 'C', gpa: 2.3 },
  { min: 33, grade: 'D', gpa: 1.0 },
  { min: 0, grade: 'F', gpa: 0.0 },
];

export function gradeForPercentage(percentage: number): {
  grade: string;
  gpa: number;
} {
  const band =
    GRADE_BANDS.find((b) => percentage >= b.min) ??
    GRADE_BANDS[GRADE_BANDS.length - 1];
  return { grade: band.grade, gpa: band.gpa };
}

/**
 * Standard competition ranking (1, 2, 2, 4 — not dense 1, 2, 2, 3): two students tied for first
 * both rank 1, and the next distinct value ranks 3rd, not 2nd. `null` values (absent, or no mark
 * entered yet) are excluded from ranking entirely and always rank `null`, never last-place —
 * "unranked" and "ranked last" are different facts.
 */
export function computeRanks(
  values: ReadonlyArray<{ id: string; value: number | null }>,
): Map<string, number | null> {
  const ranked = values
    .filter((v): v is { id: string; value: number } => v.value !== null)
    .sort((a, b) => b.value - a.value);

  const rankById = new Map<string, number | null>();
  let position = 0;
  let previousValue: number | null = null;
  let previousRank = 0;
  for (const entry of ranked) {
    position++;
    const rank = entry.value === previousValue ? previousRank : position;
    rankById.set(entry.id, rank);
    previousValue = entry.value;
    previousRank = rank;
  }
  for (const entry of values) {
    if (!rankById.has(entry.id)) rankById.set(entry.id, null);
  }
  return rankById;
}

export const EXAM_TYPE_LABELS: Record<string, string> = {
  quiz: 'Quiz',
  monthly: 'Monthly',
  midterm: 'Midterm',
  final: 'Final',
  practical: 'Practical',
  oral: 'Oral',
  entrance: 'Entrance',
  assignment: 'Assignment',
};
