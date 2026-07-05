/**
 * Quick-match matchmaking core (issue #14).
 *
 * Serverless-friendly: there is no matchmaking daemon. Pairing happens
 * opportunistically on enqueue (POST /api/queue) and on each status poll
 * (GET /api/queue). Elo bands widen with wait time so a player who waits long
 * enough eventually matches anyone.
 *
 * Concurrency note (Neon HTTP driver): the neon-http driver does not expose a
 * true interactive transaction — `db.transaction()` over HTTP batches queries
 * and cannot branch on an intermediate result. So {@link tryPair} performs the
 * whole select-lock-delete as a SINGLE atomic SQL statement built from CTEs.
 * Postgres runs a lone statement in its own implicit transaction, so the
 * `FOR UPDATE SKIP LOCKED` row locks taken in the `pair` CTE are held through
 * the `DELETE` in the same statement. See {@link tryPair} for why this yields
 * "exactly one race" under concurrent pairing.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Base band (Elo points) applied immediately on enqueue. */
export const BAND_BASE = 100;
/** Band grows by this many Elo points per {@link BAND_STEP_SEC}. */
export const BAND_STEP = 50;
/** Wait-time granularity (seconds) for band widening. */
export const BAND_STEP_SEC = 10;
/** Band is capped here; beyond this a player matches essentially anyone. */
export const BAND_MAX = 800;

/**
 * Pure Elo band for a given wait time: `100 + 50 * floor(waitedSec / 10)`,
 * capped at 800. Never returns less than the base band; non-finite or negative
 * inputs collapse to the base band.
 */
export function bandForWait(waitedSec: number): number {
  if (!Number.isFinite(waitedSec) || waitedSec <= 0) return BAND_BASE;
  const band = BAND_BASE + BAND_STEP * Math.floor(waitedSec / BAND_STEP_SEC);
  return Math.min(band, BAND_MAX);
}

export interface PairSelf {
  userId: string;
  elo: number;
}

/**
 * Attempt to pair `me` against the best waiting opponent within `band` Elo.
 *
 * Returns the matched opponent's user id (and atomically removes both `me` and
 * the opponent from the queue), or `null` if no eligible opponent was claimable
 * this round.
 *
 * Works whether or not `me` is currently in the queue:
 *  - Enqueue path (`me` not yet queued): only the opponent row is deleted.
 *  - Poll path (`me` already queued): both rows are deleted.
 *
 * ## Why this is safe under concurrency
 * The whole thing is one SQL statement:
 *   1. `candidate` picks the closest-Elo, longest-waiting eligible opponent.
 *   2. `pair` re-selects the {me, opponent} rows `ORDER BY user_id
 *      FOR UPDATE SKIP LOCKED`. Because it is `SKIP LOCKED`, it never *waits*
 *      on a lock — so concurrent pairing statements can never deadlock.
 *   3. `deleted` removes both rows only if the opponent row was actually
 *      locked (present in `pair`).
 *
 * Two players A and B polling at the same instant both target the pair {A, B}
 * and both scan it in `user_id` order. Row locks are exclusive, so at most one
 * statement can hold *both* rows; the other skips a locked row, finds the
 * opponent missing from `pair`, and deletes nothing. Therefore two concurrent
 * pairings NEVER both succeed — at most one race is created. In the rare tie
 * where each grabs only its own row, neither matches that round and both retry
 * on the next poll (the intended "loser stays queued" behaviour).
 */
export async function tryPair(me: PairSelf, band: number): Promise<string | null> {
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT user_id
      FROM queue_entries
      WHERE user_id <> ${me.userId}
        AND abs(elo - ${me.elo}) <= ${band}
      ORDER BY abs(elo - ${me.elo}), enqueued_at
      LIMIT 1
    ),
    pair AS (
      SELECT user_id
      FROM queue_entries
      WHERE user_id = ${me.userId}
         OR user_id = (SELECT user_id FROM candidate)
      ORDER BY user_id
      FOR UPDATE SKIP LOCKED
    ),
    deleted AS (
      DELETE FROM queue_entries
      WHERE user_id IN (SELECT user_id FROM pair)
        AND (SELECT user_id FROM candidate) IN (SELECT user_id FROM pair)
      RETURNING user_id
    )
    SELECT user_id FROM deleted WHERE user_id <> ${me.userId}
  `);

  const rows = (result.rows ?? []) as { user_id: string }[];
  return rows.length > 0 ? rows[0].user_id : null;
}
