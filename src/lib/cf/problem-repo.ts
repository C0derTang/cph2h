/**
 * Thin, non-pure DB helpers for problem candidate selection and upserts.
 * Kept separate from `problem-picker.ts` so the picker stays pure and
 * unit-testable without a database.
 */

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems, userProblems, type NewProblem } from "@/lib/db/schema";
import { problemUrl, type ProblemId, type ProblemRef } from "@/lib/types";

/** Row shape shared by all `problems` selects we need to turn into a `ProblemRef`. */
interface ProblemRow {
  id: string;
  contestId: number;
  index: string;
  name: string;
  rating: number;
}

function toProblemRef(row: ProblemRow): ProblemRef {
  return {
    id: row.id,
    contestId: row.contestId,
    index: row.index,
    name: row.name,
    rating: row.rating,
    url: problemUrl(row),
  };
}

/** Problem ids the user has already attempted (solved or not), from `user_problems`. */
export async function getSeenProblemIds(userId: string): Promise<Set<ProblemId>> {
  const rows = await db
    .select({ problemId: userProblems.problemId })
    .from(userProblems)
    .where(eq(userProblems.userId, userId));
  return new Set(rows.map((row) => row.problemId));
}

/** All cached problems with a rating in `[minRating, maxRating]` (inclusive). */
export async function getCandidatesInBand(
  minRating: number,
  maxRating: number,
): Promise<ProblemRef[]> {
  const rows = await db
    .select()
    .from(problems)
    .where(and(gte(problems.rating, minRating), lte(problems.rating, maxRating)));
  return rows.map(toProblemRef);
}

/** Fetch a single cached problem by id, or `null` if not cached. */
export async function getProblemById(id: ProblemId): Promise<ProblemRef | null> {
  const rows = await db.select().from(problems).where(eq(problems.id, id)).limit(1);
  const row = rows[0];
  return row ? toProblemRef(row) : null;
}

/** Batch size for upserts, to keep individual statements reasonably sized. */
const UPSERT_CHUNK_SIZE = 500;

/**
 * Upserts problem rows keyed by `id` (idempotent — safe to run repeatedly,
 * e.g. from the weekly refresh cron).
 */
export async function upsertProblems(rows: NewProblem[]): Promise<number> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    if (chunk.length === 0) {
      continue;
    }
    await db
      .insert(problems)
      .values(chunk)
      .onConflictDoUpdate({
        target: problems.id,
        set: {
          contestId: sql`excluded.contest_id`,
          index: sql`excluded.index`,
          name: sql`excluded.name`,
          rating: sql`excluded.rating`,
          tags: sql`excluded.tags`,
          fetchedAt: sql`excluded.fetched_at`,
          // COALESCE: a null incoming date must never clobber a known-good
          // one. The cron/backfill rebuild rows from the FULL problemset each
          // run and degrade to all-null dates when `contest.list` fails, so a
          // plain `excluded.contest_started_at` would wipe every previously
          // populated date on one transient CF hiccup. CF never un-dates a
          // contest, so keeping the existing value on null is always correct.
          contestStartedAt: sql`COALESCE(excluded.contest_started_at, ${problems.contestStartedAt})`,
        },
      });
  }
  return rows.length;
}
