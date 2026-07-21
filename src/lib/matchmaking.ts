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

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import type { RaceProblemFilters } from "@/lib/types";

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
  /** The caller's queued problem filters (null fields = unbounded). */
  filters: RaceProblemFilters;
}

/** A successful pairing: the claimed opponent and their stored filters. */
export interface PairResult {
  opponentId: string;
  /**
   * The opponent's own queued filters. The route intersects these with the
   * caller's filters ({@link intersectFilters}) to compute the race's filters.
   */
  opponentFilters: RaceProblemFilters;
}

// ---------------------------------------------------------------------------
// Pure filter algebra (null = unbounded)
// ---------------------------------------------------------------------------

/** Inclusive numeric range overlap; null bound = ±infinity. */
function numRangeOverlap(
  aMin: number | null,
  aMax: number | null,
  bMin: number | null,
  bMax: number | null,
): boolean {
  const aLo = aMin ?? -Infinity;
  const aHi = aMax ?? Infinity;
  const bLo = bMin ?? -Infinity;
  const bHi = bMax ?? Infinity;
  return aLo <= bHi && bLo <= aHi;
}

/** Inclusive ISO-date range overlap; null bound = ±infinity. */
function dateRangeOverlap(
  aFrom: string | null,
  aTo: string | null,
  bFrom: string | null,
  bTo: string | null,
): boolean {
  const aLo = aFrom === null ? -Infinity : Date.parse(aFrom);
  const aHi = aTo === null ? Infinity : Date.parse(aTo);
  const bLo = bFrom === null ? -Infinity : Date.parse(bFrom);
  const bHi = bTo === null ? Infinity : Date.parse(bTo);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * True when two players' filters can share at least one problem: the rating
 * ranges overlap AND the date ranges overlap (each null bound treated as
 * unbounded). Touching bounds (`a.max === b.min`) count as overlapping.
 * Symmetric in its arguments. Mirrors the SQL predicate in {@link tryPair}.
 */
export function filtersOverlap(a: RaceProblemFilters, b: RaceProblemFilters): boolean {
  return (
    numRangeOverlap(a.ratingMin, a.ratingMax, b.ratingMin, b.ratingMax) &&
    dateRangeOverlap(a.dateFrom, a.dateTo, b.dateFrom, b.dateTo)
  );
}

function tighterLower(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function tighterUpper(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function laterDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function earlierDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/**
 * The intersection of two overlapping filter sets: the tighter of each bound
 * (max of the two mins / lower dates, min of the two maxes / upper dates). A
 * bound is null only when BOTH inputs leave it null. Assumes the inputs
 * actually overlap ({@link filtersOverlap}); on disjoint inputs it still returns
 * a (possibly empty) range rather than throwing.
 */
export function intersectFilters(
  a: RaceProblemFilters,
  b: RaceProblemFilters,
): RaceProblemFilters {
  return {
    ratingMin: tighterLower(a.ratingMin, b.ratingMin),
    ratingMax: tighterUpper(a.ratingMax, b.ratingMax),
    dateFrom: laterDate(a.dateFrom, b.dateFrom),
    dateTo: earlierDate(a.dateTo, b.dateTo),
  };
}

/**
 * The single source-of-truth SQL overlap predicate, shared verbatim by the
 * enqueue and poll variants so they can never diverge. Restricts the candidate
 * `queue_entries` row (its `rating_*`/`date_*` columns) to those whose ranges
 * overlap the caller's filters `f`.
 *
 * The explicit `::int` / `::timestamptz` casts are REQUIRED: the neon-http
 * driver cannot infer a type for a `null` bind, so an uncast `$n IS NULL`
 * comparison against a null param is a runtime type error.
 */
function overlapPredicate(f: RaceProblemFilters): SQL {
  return sql`
            AND (rating_min IS NULL OR ${f.ratingMax}::int IS NULL OR rating_min <= ${f.ratingMax}::int)
            AND (rating_max IS NULL OR ${f.ratingMin}::int IS NULL OR rating_max >= ${f.ratingMin}::int)
            AND (date_from IS NULL OR ${f.dateTo}::timestamptz IS NULL OR date_from <= ${f.dateTo}::timestamptz)
            AND (date_to IS NULL OR ${f.dateFrom}::timestamptz IS NULL OR date_to >= ${f.dateFrom}::timestamptz)`;
}

/** A row shape returned by the pairing statement's `RETURNING`. */
interface PairedRow {
  user_id: string;
  rating_min: number | null;
  rating_max: number | null;
  date_from: string | Date | null;
  date_to: string | Date | null;
}

function rowToFilters(r: PairedRow): RaceProblemFilters {
  return {
    ratingMin: r.rating_min ?? null,
    ratingMax: r.rating_max ?? null,
    dateFrom: r.date_from ? new Date(r.date_from).toISOString() : null,
    dateTo: r.date_to ? new Date(r.date_to).toISOString() : null,
  };
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
): Promise<PairResult | null> {
  // ONE shared overlap fragment for both variants — they cannot diverge.
  const overlap = overlapPredicate(me.filters);

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
              AND abs(elo - ${me.elo}) <= ${band}${overlap}
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
            RETURNING user_id, rating_min, rating_max, date_from, date_to
          )
          SELECT user_id, rating_min, rating_max, date_from, date_to FROM deleted
        `
      : sql`
          WITH candidate AS (
            SELECT user_id
            FROM queue_entries
            WHERE user_id <> ${me.userId}
              AND abs(elo - ${me.elo}) <= ${band}${overlap}
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
            RETURNING user_id, rating_min, rating_max, date_from, date_to
          )
          SELECT user_id, rating_min, rating_max, date_from, date_to FROM deleted
        `;

  const result = await db.execute(query);
  const rows = (result.rows ?? []) as unknown as PairedRow[];
  const ids = new Set(rows.map((r) => r.user_id));
  // Poll mode returns BOTH deleted rows (self + opponent); enqueue mode returns
  // only the opponent's. Either way the opponent is the non-self row.
  const opponentRow = rows.find((r) => r.user_id !== me.userId) ?? null;

  if (!opponentRow) return null;

  // Belt-and-suspenders: in poll mode a race is only real if BOTH rows were
  // actually deleted (the SQL self-guard already enforces this, but never
  // create a race off a partial delete).
  if (mode === "poll" && !ids.has(me.userId)) return null;

  return {
    opponentId: opponentRow.user_id,
    opponentFilters: rowToFilters(opponentRow),
  };
}
