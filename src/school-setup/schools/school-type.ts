/**
 * `frontend/src/features/school-setup/schemas.ts`'s `SCHOOL_TYPES`, verbatim — kept as a plain
 * string column rather than a Prisma enum (see `schema.prisma`'s `School.schoolType` doc comment
 * for why the hyphenated value rules that out) and validated against this list at the DTO layer.
 */
export const SCHOOL_TYPES = [
  'primary',
  'secondary',
  'higher-secondary',
  'k12',
  'college',
  'university',
  'other',
] as const;

export type SchoolTypeValue = (typeof SCHOOL_TYPES)[number];
