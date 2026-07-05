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
import type { ProblemId, RaceEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// #6 / #9 — problem selection (+ statement pre-cache)
// ---------------------------------------------------------------------------

export type SelectRaceProblem = (race: Race) => Promise<string | null>;

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
 * Pick an unseen, in-band problem for the two players and pre-cache its
 * statement before the race goes active. Returns the `problems.id` to assign,
 * or `null` when no candidate fits (races then start with `problemId = null`
 * and can only end by timeout/forfeit).
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
  const candidates = await getCandidatesInBand(
    target - CANDIDATE_BAND_LOW,
    target + CANDIDATE_BAND_HIGH,
  );

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
  });
  if (!picked) return null;

  // Pre-cache the statement so it is available the moment the countdown ends.
  // Best-effort: if the scrape fails we still assign the problem (the snapshot
  // simply omits the statement until a later scrape succeeds).
  try {
    await getOrScrapeStatement(picked.id);
  } catch (err) {
    console.error(`[race] statement pre-cache failed for ${picked.id}`, err);
  }

  return picked.id;
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
  reason: "forfeit" | "solved" | "timeout";
}) => Promise<void>;

/** Authoritative, idempotent finish — see `src/lib/race/finish.ts`. */
export const finishRace: FinishRace = finishRaceImpl;
