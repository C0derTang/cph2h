/**
 * Problem-availability counting for challenge-creation filters (issue #64).
 *
 * `buildAvailabilityWhere` is a pure where-clause builder (no I/O) so its
 * output can be asserted directly in tests; `countAvailableProblems` is the
 * thin DB call built on top of it. Used both as the creation-time
 * `no_problems_in_range` guard (`POST /api/races`) and by `GET
 * /api/problems/availability` for live form feedback.
 *
 * No seen-problem exclusion here — the opponent (and their solve history)
 * isn't known yet at creation time; that check happens at ready time in
 * `src/lib/race/hooks.ts` (untouched by this issue).
 */

import { and, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";
import type { RaceProblemFilters } from "@/lib/types";

/**
 * Builds the `problems` where-clause for `filters`:
 *  - `ratingMin`/`ratingMax` constrain `problems.rating` (inclusive).
 *  - When either date bound is set, problems with a null `contest_started_at`
 *    are EXCLUDED (their contest date is unknown, so they can't be proven to
 *    fall inside the range).
 *
 * Returns `undefined` when `filters` has no constraint at all (matches every
 * cached problem — callers should treat this the same as "no where clause").
 */
export function buildAvailabilityWhere(filters: RaceProblemFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.ratingMin !== null) {
    conditions.push(gte(problems.rating, filters.ratingMin));
  }
  if (filters.ratingMax !== null) {
    conditions.push(lte(problems.rating, filters.ratingMax));
  }

  if (filters.dateFrom !== null || filters.dateTo !== null) {
    conditions.push(isNotNull(problems.contestStartedAt));
    if (filters.dateFrom !== null) {
      conditions.push(gte(problems.contestStartedAt, new Date(filters.dateFrom)));
    }
    if (filters.dateTo !== null) {
      conditions.push(lte(problems.contestStartedAt, new Date(filters.dateTo)));
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Count of cached `problems` rows matching `filters`. */
export async function countAvailableProblems(filters: RaceProblemFilters): Promise<number> {
  const where = buildAvailabilityWhere(filters);
  const base = db.select({ count: sql<number>`count(*)` }).from(problems);
  const rows = where ? await base.where(where) : await base;
  return Number(rows[0]?.count ?? 0);
}
