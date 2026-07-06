/**
 * Cross-issue coupling seams (issue #7), now wired to their real
 * implementations (issue #15 + the merged #6/#8/#9 modules).
 *
 * The race lifecycle backbone (routes in `src/app/api/races/*`) calls these
 * three hooks and nothing else, so integrating the problem pool, LiveKit
 * publishing, and finish/Elo happened here — the route code stayed untouched.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, users, type Race } from "@/lib/db/schema";
import {
  getCandidatesInBand,
  getSeenProblemIds,
} from "@/lib/cf/problem-repo";
import { pickProblem, targetRating } from "@/lib/cf/problem-picker";
import { getOrScrapeStatement } from "@/lib/cf/statements";
import { publishRaceEvent as publishToRoom } from "@/lib/livekit";
import { finishRace as finishRaceImpl } from "@/lib/race/finish";
import type { ProblemId, RaceEvent, SelectProblemResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// #6 / #9 — problem selection (+ statement pre-cache)
// ---------------------------------------------------------------------------

export type SelectRaceProblem = (race: Race) => Promise<SelectProblemResult>;

/**
 * The picker widens its rating band by up to `MAX_WIDEN_ATTEMPTS * WIDEN_STEP`
 * on each side beyond the initial `[-100, +200]` window. Fetch candidates over
 * that maximal band so the widening always has rows to consider.
 */
const CANDIDATE_BAND_LOW = 600;
const CANDIDATE_BAND_HIGH = 700;

/**
 * Deterministic 32-bit seed derived from the race id (a uuid). No `Math.random`
 * so a given race always resolves to the same problem.
 */
function seedFromRaceId(raceId: string): number {
  let hash = 0;
  for (let i = 0; i < raceId.length; i++) {
    hash = (Math.imul(hash, 31) + raceId.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Pick an unseen, in-band, filter-conforming problem for the two players and
 * pre-cache its statement before the race goes active.
 *
 * Returns a {@link SelectProblemResult}: on success the `problems.id` to
 * assign; on failure a discriminated reason (`no_problems_in_filters` /
 * `all_problems_seen`) — the ready route uses this to keep the race in the
 * lobby instead of starting with a null problem.
 *
 * The challenger's filters (race row columns) are hard constraints:
 * - Candidates are fetched over the target's rating window, but the fetch
 *   range is *widened to the full filter rating range* whenever a rating bound
 *   is set, so the picker sees the whole conforming universe (needed for an
 *   accurate `no_problems_in_filters` vs `all_problems_seen` distinction and
 *   for the picker's conforming-fallback).
 * - Date bounds are pushed into the query (null-date problems excluded when a
 *   date filter is set — see `getCandidatesInBand`).
 */
export const selectRaceProblem: SelectRaceProblem = async (race) => {
  const playerIds = [race.p1Id, race.p2Id].filter(
    (id): id is string => id !== null,
  );
  const playerRows = await db
    .select({ id: users.id, cfRating: users.cfRating })
    .from(users)
    .where(inArray(users.id, playerIds));
  const ratingById = new Map(playerRows.map((u) => [u.id, u.cfRating]));

  const p1Rating = ratingById.get(race.p1Id) ?? null;
  const p2Rating = race.p2Id ? ratingById.get(race.p2Id) ?? null : null;

  const target = targetRating(p1Rating, p2Rating);
  const filterMin = race.ratingMin;
  const filterMax = race.ratingMax;

  // Fetch range: the target window, extended to the full filter range on any
  // side a filter bound is set (so the picker sees every conforming problem).
  const fetchMin = filterMin ?? target - CANDIDATE_BAND_LOW;
  const fetchMax = filterMax ?? target + CANDIDATE_BAND_HIGH;

  const candidates = await getCandidatesInBand(fetchMin, fetchMax, {
    dateFrom: race.problemDateFrom,
    dateTo: race.problemDateTo,
  });

  const seenIds = new Set<ProblemId>();
  for (const userId of playerIds) {
    const seen = await getSeenProblemIds(userId);
    for (const id of seen) seenIds.add(id);
  }

  const picked = pickProblem({
    candidates,
    seenIds,
    p1Rating,
    p2Rating,
    seed: seedFromRaceId(race.id),
    ratingMin: filterMin,
    ratingMax: filterMax,
  });
  if (!picked.ok) return picked;

  // Pre-cache the statement so it is available the moment the countdown ends.
  // Best-effort: if the scrape fails we still assign the problem (the snapshot
  // simply omits the statement until a later scrape succeeds).
  try {
    await getOrScrapeStatement(picked.problem.id);
  } catch (err) {
    console.error(`[race] statement pre-cache failed for ${picked.problem.id}`, err);
  }

  return { ok: true, problemId: picked.problem.id };
};

// ---------------------------------------------------------------------------
// #8 — LiveKit event publishing
// ---------------------------------------------------------------------------

export type PublishRaceEvent = (
  raceId: string,
  event: RaceEvent,
) => Promise<void>;

/**
 * Look up the race's LiveKit room and publish `event` on its data channel.
 * Best-effort: a missing race or LiveKit error never surfaces (the underlying
 * `publishRaceEvent` swallows transport errors; events are hints and clients
 * refetch the snapshot as the source of truth).
 */
export const publishRaceEvent: PublishRaceEvent = async (raceId, event) => {
  const [race] = await db
    .select({ room: races.livekitRoom })
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);
  if (!race) return;
  await publishToRoom(race.room, event);
};

// ---------------------------------------------------------------------------
// #15 — finish + Elo application
// ---------------------------------------------------------------------------

export type FinishRace = (input: {
  raceId: string;
  outcome: "p1_win" | "p2_win" | "draw";
  winnerId: string | null;
  reason: "forfeit" | "solved" | "timeout" | "agreement";
}) => Promise<void>;

/** Authoritative, idempotent finish — see `src/lib/race/finish.ts`. */
export const finishRace: FinishRace = finishRaceImpl;
