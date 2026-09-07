import { PagedResult } from './list-query.dto';

/**
 * Runs a list's `findMany`/`count` pair concurrently and wraps the result in the
 * `{ items, total }` shape every list endpoint returns (`list-query.dto.ts`'s own doc comment).
 * Takes thunks rather than a Prisma delegate directly so each service keeps full control of its
 * own `where`/`orderBy`/`select`/`include` — this helper only owns the "run both, shape the
 * result" part, not the query itself.
 */
export async function paginate<T>(
  findMany: () => Promise<T[]>,
  count: () => Promise<number>,
): Promise<PagedResult<T>> {
  const [items, total] = await Promise.all([findMany(), count()]);
  return { items, total };
}

export function toSkipTake(
  page: number,
  pageSize: number,
): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Resolves a client-supplied `sortBy` against an explicit allow-list of sortable columns,
 * falling back rather than erroring on an unknown value — a stale/guessed `sortBy` should degrade
 * to the default order, not 400 a list screen. Never pass `sortBy` straight through to Prisma's
 * `orderBy`: an allow-list here is what stops a client picking an unindexed or non-existent column
 * (security-standards: validate input against a known set rather than trusting it structurally).
 */
export function resolveSortField<T extends string>(
  sortBy: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(sortBy ?? '')
    ? (sortBy as T)
    : fallback;
}
