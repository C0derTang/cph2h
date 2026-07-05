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
 * Which side of the flow is pairing, which determines the required proof of
 * atomicity before the delete may fire:
 *  - `"enqueue"`: caller is NOT in the queue (POST, before joining). Only the
 *    opponent's row is deleted; no opponent can be racing against the caller
 *    because the caller isn't in the queue.
 *  - `"poll"`: caller IS in the queue (GET status). Both rows are deleted, and
 *    the delete only fires if the caller's OWN row was actually locked.
 */
export type PairMode = "enqueue" | "poll";

/**
 * Attempt to pair `me` against the best waiting opponent within `band` Elo.
 *
 * Returns the matched opponent's user id (having atomically removed the paired
 * rows from the queue), or `null` if no eligible opponent was claimable this
 * round.
 *
 * ## Why this is safe under concurrency
 * The whole select-lock-delete is ONE SQL statement (Postgres runs it in its
 * own implicit transaction, so the `FOR UPDATE SKIP LOCKED` row locks taken in
 * `pair` are held through the `DELETE`):
 *   1. `candidate` picks the closest-Elo, longest-waiting eligible opponent.
 *   2. `pair` re-selects the rows to claim `ORDER BY user_id
 *      FOR UPDATE SKIP LOCKED`. Because it is `SKIP LOCKED` it never *waits* on
 *      a lock, so concurrent pairing statements can never deadlock — a locked
 *      row is simply skipped and drops out of `pair`.
 *   3. `deleted` fires only when the required rows were actually locked.
 *
 * ### The self-guard (poll mode) — closes the 3+ concurrent-poller hole
 * `SKIP LOCKED` means a row silently drops out of `pair` if another concurrent
 * `tryPair` already holds it. So checking only that the *opponent* was locked is
 * NOT enough: with players A, B, C all in-band, A's poll can lock {A, B} and
 * create race (A, B) while B's concurrent poll — whose own row is now locked by
 * A — sees `pair = {C}` and would wrongly delete C, creating race (B, C) and
 * orphaning someone. So in poll mode the delete additionally requires the
 * caller's own row to be present in `pair` (`me IN pair`) and present in the
 * queue (`EXISTS self`). If B's row was claimed by A, B's `me IN pair` is false
 * and B deletes nothing — B stays "matched" via the race A already created and
 * never double-books.
 *
 * We cannot express this as a single `NOT EXISTS(self) OR me IN pair` predicate:
 * that treats "self absent" as always-legitimate, but a poll-path caller whose
 * row was consumed between GET's entry lookup and this statement is *not*
 * legitimately absent — permitting a match there re-opens the double-book. Only
 * the caller knows which flow it is, hence the explicit {@link PairMode}.
 *
 * At most one statement can hold both rows of any pair, so two concurrent
 * pairings NEVER both succeed — exactly one race per pair. In the rare tie where
 * each grabs only its own row, neither matches that round and both retry on the
 * next poll (the intended "loser stays queued" behaviour).
 */
export async function tryPair(
  me: PairSelf,
  band: number,
  mode: PairMode,
): Promise<string | null> {
  const query =
    mode === "poll"
      ? sql`
          WITH self AS (
            SELECT user_id
            FROM queue_entries
            WHERE user_id = ${me.userId}
          ),
          candidate AS (
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
              AND ${me.userId} IN (SELECT user_id FROM pair)
              AND EXISTS (SELECT 1 FROM self)
            RETURNING user_id
          )
          SELECT user_id FROM deleted
        `
      : sql`
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
            WHERE user_id = (SELECT user_id FROM candidate)
            ORDER BY user_id
            FOR UPDATE SKIP LOCKED
          ),
          deleted AS (
            DELETE FROM queue_entries
            WHERE user_id IN (SELECT user_id FROM pair)
              AND (SELECT user_id FROM candidate) IN (SELECT user_id FROM pair)
            RETURNING user_id
          )
          SELECT user_id FROM deleted
        `;

  const result = await db.execute(query);
  const rows = (result.rows ?? []) as { user_id: string }[];
  const ids = new Set(rows.map((r) => r.user_id));
  const opponentId = rows.find((r) => r.user_id !== me.userId)?.user_id ?? null;

  if (!opponentId) return null;

  // Belt-and-suspenders: in poll mode a race is only real if BOTH rows were
  // actually deleted (the SQL self-guard already enforces this, but never
  // create a race off a partial delete).
  if (mode === "poll" && !ids.has(me.userId)) return null;

  return opponentId;
}
